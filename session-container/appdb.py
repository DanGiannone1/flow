"""Mock Flow application data store for the POC.

State lives in a single JSON doc (`.flowdb.json`) inside the per-session workspace
folder — intentionally NO database. The agent's tools read and mutate this store and
the frontend renders it verbatim via the `/app/state` endpoint, so "the agent says it
did something" and "the record actually exists" are the same fact.

Flow is a small personal-productivity app. Two record types live here:
a *Task* (a to-do with a status, priority, group bucket, optional due date, and a list
of subtasks) and an *Event* (a calendar entry — a meeting, reminder, or focus block on
a given day). Documents (drafts the assistant writes) live as files in the workspace and
are surfaced separately. There is no user/account hierarchy — it's one person's workspace.
"""

from __future__ import annotations

import json
import os
import re
import threading
from datetime import datetime, timezone
from pathlib import Path

DB_FILENAME = ".flowdb.json"
_LOCK = threading.Lock()

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
        "tasks": [
            {
                "id": "t-1",
                "title": "Draft Q3 planning doc",
                "status": "In progress",
                "priority": "High",
                "group": "Work",
                "dueDate": "2026-06-25",
                "subtasks": [
                    {"text": "Outline goals", "done": True},
                    {"text": "Pull last quarter's metrics", "done": False},
                    {"text": "Draft summary section", "done": False},
                ],
                "notes": "Share with the team before the Friday review.",
                "createdAt": "2026-06-18T09:00:00+00:00",
            },
            {
                "id": "t-2",
                "title": "Reply to onboarding survey",
                "status": "To do",
                "priority": "Medium",
                "group": "Work",
                "dueDate": "2026-06-20",
                "subtasks": [],
                "notes": "",
                "createdAt": "2026-06-15T14:30:00+00:00",
            },
            {
                "id": "t-3",
                "title": "Renew gym membership",
                "status": "To do",
                "priority": "Low",
                "group": "Personal",
                "dueDate": "2026-06-30",
                "subtasks": [],
                "notes": "",
                "createdAt": "2026-06-12T08:00:00+00:00",
            },
            {
                "id": "t-4",
                "title": "Prepare slides for design review",
                "status": "Blocked",
                "priority": "High",
                "group": "Work",
                "dueDate": "2026-06-24",
                "subtasks": [
                    {"text": "Get final mockups from design", "done": False},
                ],
                "notes": "Waiting on the updated mockups.",
                "createdAt": "2026-06-16T11:00:00+00:00",
            },
            {
                "id": "t-5",
                "title": "Book dentist appointment",
                "status": "Done",
                "priority": "Low",
                "group": "Personal",
                "dueDate": "2026-06-19",
                "subtasks": [],
                "notes": "",
                "createdAt": "2026-06-10T17:00:00+00:00",
            },
            {
                "id": "t-6",
                "title": "Review Q2 budget spreadsheet",
                "status": "To do",
                "priority": "Medium",
                "group": "Finance",
                "dueDate": "2026-07-02",
                "subtasks": [
                    {"text": "Check travel line items", "done": False},
                    {"text": "Flag overruns", "done": False},
                ],
                "notes": "",
                "createdAt": "2026-06-17T10:15:00+00:00",
            },
        ],
        "events": [
            {
                "id": "e-1",
                "title": "Team standup",
                "date": "2026-06-23",
                "start": "09:30",
                "end": "09:45",
                "type": "Meeting",
                "notes": "Daily sync.",
            },
            {
                "id": "e-2",
                "title": "1:1 with manager",
                "date": "2026-06-23",
                "start": "14:00",
                "end": "14:30",
                "type": "Meeting",
                "notes": "",
            },
            {
                "id": "e-3",
                "title": "Design review",
                "date": "2026-06-24",
                "start": "11:00",
                "end": "12:00",
                "type": "Meeting",
                "notes": "Walk through the updated mockups.",
            },
            {
                "id": "e-4",
                "title": "Focus block: Q3 planning",
                "date": "2026-06-25",
                "start": "15:00",
                "end": "17:00",
                "type": "Focus",
                "notes": "Heads-down on the planning doc.",
            },
        ],
        # Catalog of navigable pages. `keywords` help the navigate tool resolve
        # free-text destinations deterministically without a separate LLM routing pass.
        # NOTE: the AI Workbench (/assistant) is a frontend-only route and is intentionally
        # NOT listed here.
        "routes": [
            {"path": "/home", "title": "Home", "keywords": ["home", "today", "overview", "agenda", "start", "dashboard"]},
            {"path": "/todo", "title": "To-Do", "keywords": ["todo", "to do", "to-do", "tasks", "task", "list", "checklist"]},
            {"path": "/calendar", "title": "Calendar", "keywords": ["calendar", "schedule", "events", "event", "meetings", "agenda"]},
            {"path": "/documents", "title": "Documents", "keywords": ["documents", "docs", "notes", "files", "drafts", "library"]},
        ],
    }


def _db_path(workspace: str) -> Path:
    return Path(workspace) / DB_FILENAME


def ensure_seeded(workspace: str) -> dict:
    """Create the DB file with seed data if it does not exist; return the DB."""
    path = _db_path(workspace)
    with _LOCK:
        if not path.exists():
            path.parent.mkdir(parents=True, exist_ok=True)
            data = _seed()
            path.write_text(json.dumps(data, indent=2), encoding="utf-8")
            return data
        return json.loads(path.read_text(encoding="utf-8"))


def load(workspace: str) -> dict:
    """Load the DB, seeding first if absent."""
    path = _db_path(workspace)
    if not path.exists():
        return ensure_seeded(workspace)
    with _LOCK:
        raw = path.read_text(encoding="utf-8")
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        # Fail loud: a corrupt store must not be papered over with a fresh seed
        # (that would silently destroy the user's workspace).
        raise RuntimeError(f"Corrupt workspace store at {path}: {exc}") from exc


def save(workspace: str, data: dict) -> None:
    path = _db_path(workspace)
    payload = json.dumps(data, indent=2)
    with _LOCK:
        path.parent.mkdir(parents=True, exist_ok=True)
        # Atomic write: serialize to a temp file in the same dir, then os.replace
        # so a kill/teardown mid-write can never leave a half-written store.
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_text(payload, encoding="utf-8")
        os.replace(tmp, path)


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
