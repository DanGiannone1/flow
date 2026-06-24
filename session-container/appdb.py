"""Mock Flow application data store for the POC.

The app state (currentRoute/tasks/events/routes) lives in **Azure Cosmos DB** as ONE
document for the single owner, keyed by a stable owner id (`COSMOS_OWNER_ID`, default
`"owner"`) — NOT the ephemeral per-session id. Flow is one person's workspace, so the
same document loads on every visit and survives new tabs, reloads, and restarts.
Documents/files stay in the per-session workspace folder. The agent's tools read and
mutate this store and the frontend renders it verbatim via the `/app/state` endpoint,
so "the agent says it did something" and "the record actually exists" are the same fact.

Flow is a small personal-productivity app. Two record types live here:
a *Task* (a to-do with a status, priority, group bucket, optional due date, and a list
of subtasks) and an *Event* (a calendar entry — a meeting, reminder, or focus block on
a given day). Documents (drafts the assistant writes) live as files in the workspace and
are surfaced separately. There is no user/account hierarchy — it's one person's workspace.
"""

from __future__ import annotations

import os
import re
import threading
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from azure.cosmos import CosmosClient
from azure.cosmos import exceptions as cosmos_exceptions
from azure.identity import DefaultAzureCredential

_LOCK = threading.Lock()

# The app state (currentRoute/tasks/events/routes) is stored as ONE Cosmos document
# keyed by a STABLE owner id (single-user app), so it persists across sessions/tabs/
# restarts. Documents/files stay in the per-session workspace folder. AAD-only (no
# account key): DefaultAzureCredential — az login locally, managed identity in ACA.
_STATE_KEYS = ("currentRoute", "tasks", "events", "routes", "schedules")
# Single-user POC: one stable key for the owner's data. Swap to the Entra `oid` here
# when multi-user accounts are introduced — nothing else in this module changes.
_OWNER_ID = os.getenv("COSMOS_OWNER_ID", "owner")
_container_singleton = None


def _container():
    """Lazily build (and cache) the Cosmos container client. Fail loud if unconfigured."""
    global _container_singleton
    if _container_singleton is not None:
        return _container_singleton
    with _LOCK:
        if _container_singleton is not None:
            return _container_singleton
        endpoint = os.getenv("COSMOS_ENDPOINT")
        if not endpoint:
            raise RuntimeError(
                "COSMOS_ENDPOINT is not set — Cosmos is required for app state; "
                "refusing to silently fall back to a local file."
            )
        database = os.getenv("COSMOS_DATABASE", "flow")
        container = os.getenv("COSMOS_CONTAINER", "appstate")
        client = CosmosClient(endpoint, credential=DefaultAzureCredential())
        _container_singleton = client.get_database_client(database).get_container_client(container)
        return _container_singleton


def _owner_id() -> str:
    # Single stable key for the one owner's app state — independent of the per-session
    # workspace folder, so the same document loads on every visit.
    return _OWNER_ID

# Task lifecycle. A "Done" task is considered complete / not overdue.
TASK_STATUSES = ["To do", "In progress", "Blocked", "Done"]
TASK_PRIORITIES = ["Low", "Medium", "High"]
DONE_STATUSES = {"done", "complete", "completed", "closed"}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _seed() -> dict:
    """A fresh seeded Flow dataset — a small set of tasks and calendar events."""
    return {
        "currentRoute": "/home",
        # New sessions start empty — tasks and events are created by the user
        # (manual UI) or the agent, then persisted to Cosmos.
        "tasks": [],
        "events": [],
        # Scheduled reminders — saved prompts the orchestrator runs on a cadence and
        # emails the result. Created by the user (via the agent) and persisted to Cosmos.
        "schedules": [],
        # Catalog of navigable pages. `keywords` help the navigate tool resolve
        # free-text destinations deterministically without a separate LLM routing pass.
        # NOTE: the AI Workbench (/assistant) is a frontend-only route and is intentionally
        # NOT listed here.
        "routes": [
            {"path": "/home", "title": "Home", "keywords": ["home", "today", "overview", "agenda", "start", "dashboard"]},
            {"path": "/todo", "title": "To-Do", "keywords": ["todo", "to do", "to-do", "tasks", "task", "list", "checklist"]},
            {"path": "/calendar", "title": "Calendar", "keywords": ["calendar", "schedule", "events", "event", "meetings", "agenda"]},
            {"path": "/documents", "title": "Documents", "keywords": ["documents", "docs", "notes", "files", "drafts", "library"]},
            {"path": "/reminders", "title": "Reminders", "keywords": ["reminders", "reminder", "schedules", "scheduled", "recurring", "digest", "summary email"]},
        ],
    }


def _doc_to_state(doc: dict) -> dict:
    """Strip Cosmos system fields (_rid/_etag/_ts/id/sessionId) → just the app-state shape.

    Collections missing from older docs (e.g. `schedules` added after first seed) are
    coerced to [] so callers never have to null-check.
    """
    state = {k: doc.get(k) for k in _STATE_KEYS}
    for k in ("tasks", "events", "routes", "schedules"):
        if state.get(k) is None:
            state[k] = []
    if state.get("currentRoute") is None:
        state["currentRoute"] = "/home"
    return state


def ensure_seeded() -> dict:
    """Return the owner's state from Cosmos, creating a seeded doc if absent."""
    oid = _owner_id()
    container = _container()
    try:
        return _doc_to_state(container.read_item(item=oid, partition_key=oid))
    except cosmos_exceptions.CosmosResourceNotFoundError:
        data = _seed()
        container.create_item({"id": oid, "sessionId": oid, **data})
        return data


def load() -> dict:
    """Load the owner's state document from Cosmos, seeding first if absent."""
    oid = _owner_id()
    container = _container()
    try:
        return _doc_to_state(container.read_item(item=oid, partition_key=oid))
    except cosmos_exceptions.CosmosResourceNotFoundError:
        return ensure_seeded()


def save(data: dict) -> None:
    """Upsert the owner's full state document to Cosmos (last-write-wins)."""
    oid = _owner_id()
    container = _container()
    container.upsert_item({"id": oid, "sessionId": oid, **{k: data.get(k) for k in _STATE_KEYS}})


# ── Derived helpers ─────────────────────────────────────────────────────────

def task_route(task_id: str) -> str:
    return f"/todo/{task_id}"


def event_route(event_id: str) -> str:
    return f"/calendar/{event_id}"


def find_task(data: dict, task_id: str) -> dict | None:
    return next((t for t in data["tasks"] if t["id"] == task_id), None)


def find_event(data: dict, event_id: str) -> dict | None:
    return next((e for e in data["events"] if e["id"] == event_id), None)


def resolve_task(data: dict, ref: str) -> dict | None:
    """Resolve a task by id, then exact title, then case-insensitive substring."""
    ref = (ref or "").strip()
    if not ref:
        return None
    by_id = find_task(data, ref)
    if by_id:
        return by_id
    low = ref.lower()
    exact = [t for t in data["tasks"] if t["title"].lower() == low]
    if len(exact) == 1:
        return exact[0]
    partial = [t for t in data["tasks"] if low in t["title"].lower()]
    return partial[0] if len(partial) == 1 else None


def resolve_event(data: dict, ref: str) -> dict | None:
    """Resolve an event by id, then exact title, then case-insensitive substring."""
    ref = (ref or "").strip()
    if not ref:
        return None
    by_id = find_event(data, ref)
    if by_id:
        return by_id
    low = ref.lower()
    exact = [e for e in data["events"] if e["title"].lower() == low]
    if len(exact) == 1:
        return exact[0]
    partial = [e for e in data["events"] if low in e["title"].lower()]
    return partial[0] if len(partial) == 1 else None


def is_overdue(task: dict, today: str | None = None) -> bool:
    """A task is overdue iff its due date is past today and it isn't done."""
    if str(task.get("status", "")).lower() in DONE_STATUSES:
        return False
    d = (task.get("dueDate") or "")[:10]
    today = today or datetime.now(timezone.utc).date().isoformat()
    try:
        return datetime.strptime(d, "%Y-%m-%d").date() < datetime.strptime(today, "%Y-%m-%d").date()
    except ValueError:
        return False


def resolve_destination(data: dict, destination: str) -> dict:
    """Resolve a free-text destination to a concrete route.

    Returns one of:
      {"status": "resolved", "path": str, "title": str}
      {"status": "ambiguous", "candidates": [{"path","title"}...]}
      {"status": "not_found", "candidates": [...]}

    Deterministic matching only — no LLM. This is the contrast to a multi-call
    navigation-agent design: the agent makes ONE navigate call and gets a grounded
    answer (or a small candidate list to disambiguate). It matches over the static
    routes plus individual tasks and events by title.
    """
    q = (destination or "").strip().lower()
    if not q:
        return {"status": "not_found", "candidates": _all_destinations(data)[:8]}

    # 1) Exact static route path or title.
    for route in data["routes"]:
        if q == route["path"].lower() or q == route["title"].lower():
            return {"status": "resolved", "path": route["path"], "title": route["title"]}

    # 2) Tasks / events by exact title.
    t_exact = [t for t in data["tasks"] if t["title"].lower() == q]
    e_exact = [e for e in data["events"] if e["title"].lower() == q]
    if len(t_exact) + len(e_exact) == 1:
        if t_exact:
            t = t_exact[0]
            return {"status": "resolved", "path": task_route(t["id"]), "title": t["title"]}
        e = e_exact[0]
        return {"status": "resolved", "path": event_route(e["id"]), "title": e["title"]}

    # 3) Word-boundary / keyword matching across routes + tasks + events. Deliberately NOT
    # raw bidirectional substring (a 1-2 char query like "x" must not match inside a word).
    def _word_in(needle: str, hay: str) -> bool:
        needle = needle.strip().lower()
        return bool(needle) and re.search(r"\b" + re.escape(needle) + r"\b", hay) is not None

    # Filler words that may surround a real destination ("my calendar", "the documents
    # page"). A keyword match is only trusted if, after removing the matched keyword and
    # these stopwords, NO content words remain — otherwise "crypto mining dashboard" would
    # resolve to Home via the "dashboard" keyword instead of failing loud.
    _STOPWORDS = {"my", "the", "a", "an", "to", "go", "goto", "take", "me", "please",
                  "page", "section", "view", "tab", "screen", "area", "open", "show",
                  "of", "for", "in", "on", "into", "us", "back"}
    q_tokens = set(re.findall(r"[a-z0-9]+", q))

    matches: list[dict] = []
    for route in data["routes"]:
        title = route["title"].lower()
        kws = [k.lower() for k in route.get("keywords", [])]
        title_sub = len(q) >= 3 and q in title
        kw_hits = [kw for kw in kws if _word_in(kw, q)]
        q_in_kw = len(q) >= 3 and any(q in kw for kw in kws)
        if not (title_sub or kw_hits or q_in_kw):
            continue
        # Guard: a match resting ONLY on a keyword must not leave unexplained content words.
        if kw_hits and not title_sub and not q_in_kw:
            kw_tokens = {t for kw in kw_hits for t in re.findall(r"[a-z0-9]+", kw)}
            residual = q_tokens - kw_tokens - _STOPWORDS
            if residual:
                continue
        matches.append({"path": route["path"], "title": route["title"]})
    for t in data["tasks"]:
        if len(q) >= 3 and q in t["title"].lower():
            matches.append({"path": task_route(t["id"]), "title": t["title"]})
    for e in data["events"]:
        if len(q) >= 3 and q in e["title"].lower():
            matches.append({"path": event_route(e["id"]), "title": e["title"]})

    seen: set[str] = set()
    deduped = [m for m in matches if not (m["path"] in seen or seen.add(m["path"]))]

    if len(deduped) == 1:
        return {"status": "resolved", "path": deduped[0]["path"], "title": deduped[0]["title"]}
    if len(deduped) > 1:
        return {"status": "ambiguous", "candidates": deduped}
    return {"status": "not_found", "candidates": _all_destinations(data)[:8]}


def _all_destinations(data: dict) -> list[dict]:
    dests = [{"path": r["path"], "title": r["title"]} for r in data["routes"]]
    dests += [{"path": task_route(t["id"]), "title": t["title"]} for t in data["tasks"]]
    dests += [{"path": event_route(e["id"]), "title": e["title"]} for e in data["events"]]
    return dests


def new_id(prefix: str, existing: list[dict]) -> str:
    ids = {item["id"] for item in existing}
    n = len(existing) + 1
    while f"{prefix}-{n}" in ids:
        n += 1
    return f"{prefix}-{n}"


# ── Scheduled reminders ──────────────────────────────────────────────────────
# A schedule is a saved prompt the orchestrator runs on a cadence, emailing the
# result. Cadence is intentionally simple (daily / weekly at HH:MM in a timezone) —
# no cron dependency. `nextRunAt` is a UTC ISO timestamp the scheduler compares to now.

SCHEDULE_FREQUENCIES = ["daily", "weekly"]
# Monday=0 … Sunday=6 (matches datetime.weekday()).
DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def find_schedule(data: dict, schedule_id: str) -> dict | None:
    return next((s for s in data.get("schedules", []) if s["id"] == schedule_id), None)


def resolve_schedule(data: dict, ref: str) -> dict | None:
    """Resolve a schedule by id, then exact title, then case-insensitive substring."""
    ref = (ref or "").strip()
    if not ref:
        return None
    by_id = find_schedule(data, ref)
    if by_id:
        return by_id
    low = ref.lower()
    schedules = data.get("schedules", [])
    exact = [s for s in schedules if s["title"].lower() == low]
    if len(exact) == 1:
        return exact[0]
    partial = [s for s in schedules if low in s["title"].lower()]
    return partial[0] if len(partial) == 1 else None


def _parse_hhmm(time_str: str) -> tuple[int, int]:
    """Parse 'HH:MM' (24h) → (hour, minute); raises ValueError on bad input."""
    parts = (time_str or "").strip().split(":")
    if len(parts) != 2:
        raise ValueError(f"time must be HH:MM (24h), got {time_str!r}")
    hh, mm = int(parts[0]), int(parts[1])
    if not (0 <= hh <= 23 and 0 <= mm <= 59):
        raise ValueError(f"time out of range: {time_str!r}")
    return hh, mm


def normalize_timezone(timezone_name: str) -> str:
    """Validate a tz name, returning it normalized; raises ValueError if unknown."""
    tz = (timezone_name or "UTC").strip() or "UTC"
    try:
        ZoneInfo(tz)
    except Exception as exc:  # ZoneInfoNotFoundError + others
        raise ValueError(f"unknown timezone {tz!r}") from exc
    return tz


def compute_next_run(frequency: str, time_str: str, timezone_name: str,
                     days_of_week: list[int] | None = None,
                     after: datetime | None = None) -> datetime:
    """Return the next UTC datetime a schedule should fire, strictly after `after`.

    `time_str` is HH:MM in the schedule's own timezone. daily = every day at that
    time; weekly = on each listed day-of-week (Mon=0…Sun=6) at that time.
    """
    hh, mm = _parse_hhmm(time_str)
    tz = ZoneInfo(normalize_timezone(timezone_name))
    after = (after or datetime.now(timezone.utc)).astimezone(timezone.utc)
    local_after = after.astimezone(tz)
    if (frequency or "daily").lower() == "weekly":
        days = sorted(set(days_of_week or []))
        if not days:
            raise ValueError("weekly schedule requires at least one day of week")
    else:
        days = list(range(7))  # daily = every day
    # Scan forward up to 8 days for the next matching (day, time) strictly after `after`.
    for delta in range(0, 8):
        d = (local_after + timedelta(days=delta)).date()
        if d.weekday() not in days:
            continue
        candidate = datetime(d.year, d.month, d.day, hh, mm, tzinfo=tz).astimezone(timezone.utc)
        if candidate > after:
            return candidate
    raise RuntimeError("could not compute next run within 8 days")  # unreachable


def schedule_summary(s: dict) -> str:
    """One-line human description of a schedule's cadence, e.g. 'Daily at 08:00 (UTC)'."""
    freq = (s.get("frequency") or "daily").lower()
    tz = s.get("timezone") or "UTC"
    when = s.get("time") or "??:??"
    if freq == "weekly":
        days = ", ".join(DAY_NAMES[d] for d in sorted(s.get("daysOfWeek") or []) if 0 <= d <= 6)
        return f"Weekly on {days or '—'} at {when} ({tz})"
    return f"Daily at {when} ({tz})"
