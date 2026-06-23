"""Mock Tax Workbench application data store for the POC.

State lives in a single JSON doc (`.taxdb.json`) inside the per-session workspace
folder — intentionally NO database. The agent's tools read and mutate this store and
the frontend renders it verbatim via the `/app/state` endpoint, so "the agent says it
did something" and "the record actually exists" are the same fact.

The app is deliberately simple: a flat **tax-filing tracker**. The only record type is
a *Filing* (a tax return / obligation with a due date, status, assignee, and a checklist
of steps). Documents (drafts the assistant writes) live as files in the workspace and are
surfaced separately. There is no client/engagement hierarchy — it's one team's workspace.
"""

from __future__ import annotations

import json
import os
import re
import threading
from datetime import datetime, timezone
from pathlib import Path

DB_FILENAME = ".taxdb.json"
_LOCK = threading.Lock()

# Filing lifecycle (a "Filed" filing is considered done / not overdue).
FILING_STATUSES = ["Not started", "In progress", "In review", "Filed"]
DONE_STATUSES = {"filed", "complete", "completed", "closed", "done"}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _seed() -> dict:
    """A fresh seeded Tax Workbench dataset — a simple list of tax filings."""
    return {
        "currentRoute": "/dashboard",
        "filings": [
            {
                "id": "f-1120",
                "title": "2025 Federal Form 1120",
                "type": "Federal return",
                "status": "In progress",
                "dueDate": "2026-10-15",
                "assignee": "J. Okafor",
                "checklist": [
                    {"text": "Reconcile book-tax differences", "done": False},
                    {"text": "Gather outstanding client items", "done": False},
                    {"text": "Prepare return", "done": False},
                    {"text": "Partner review", "done": False},
                ],
                "createdAt": "2026-05-01T09:00:00+00:00",
            },
            {
                "id": "f-7004",
                "title": "Federal Extension (Form 7004)",
                "type": "Extension",
                "status": "Filed",
                "dueDate": "2026-04-15",
                "assignee": "J. Okafor",
                "checklist": [
                    {"text": "Prepare extension", "done": True},
                    {"text": "E-file", "done": True},
                ],
                "createdAt": "2026-03-20T09:00:00+00:00",
            },
            {
                "id": "f-q2est",
                "title": "Q2 2026 Federal Estimated Payment",
                "type": "Estimated payment",
                "status": "In progress",
                "dueDate": "2026-06-15",
                "assignee": "D. Nguyen",
                "checklist": [
                    {"text": "Compute the estimate", "done": True},
                    {"text": "Submit the payment", "done": False},
                ],
                "createdAt": "2026-05-20T09:00:00+00:00",
            },
            {
                "id": "f-q3est",
                "title": "Q3 2026 Federal Estimated Payment",
                "type": "Estimated payment",
                "status": "Not started",
                "dueDate": "2026-09-15",
                "assignee": "Unassigned",
                "checklist": [],
                "createdAt": "2026-05-20T09:05:00+00:00",
            },
            {
                "id": "f-ca100",
                "title": "2025 California Form 100",
                "type": "State return",
                "status": "Not started",
                "dueDate": "2026-11-15",
                "assignee": "Unassigned",
                "checklist": [
                    {"text": "Confirm CA apportionment", "done": False},
                    {"text": "Prepare return", "done": False},
                ],
                "createdAt": "2026-05-03T10:00:00+00:00",
            },
            {
                "id": "f-provision",
                "title": "FY2025 Tax Provision (ASC 740)",
                "type": "Provision",
                "status": "In progress",
                "dueDate": "2026-07-31",
                "assignee": "D. Nguyen",
                "checklist": [
                    {"text": "Roll forward deferred balances", "done": False},
                    {"text": "Rate reconciliation", "done": False},
                ],
                "createdAt": "2026-05-04T08:30:00+00:00",
            },
        ],
        # Catalog of navigable pages. `keywords` help the navigate tool resolve
        # free-text destinations deterministically without a separate LLM routing pass.
        "routes": [
            {"path": "/dashboard", "title": "Dashboard", "keywords": ["home", "dashboard", "start", "overview"]},
            {"path": "/filings", "title": "Filings", "keywords": ["filings", "returns", "filing", "work", "deadlines", "tasks", "to do"]},
            {"path": "/documents", "title": "Documents", "keywords": ["documents", "docs", "letters", "memos", "drafts", "files"]},
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

def filing_route(filing_id: str) -> str:
    return f"/filings/{filing_id}"


def find_filing(data: dict, filing_id: str) -> dict | None:
    return next((f for f in data["filings"] if f["id"] == filing_id), None)


def resolve_filing(data: dict, ref: str) -> dict | None:
    """Resolve a filing by id, then exact title, then case-insensitive substring."""
    ref = (ref or "").strip()
    if not ref:
        return None
    by_id = find_filing(data, ref)
    if by_id:
        return by_id
    low = ref.lower()
    exact = [f for f in data["filings"] if f["title"].lower() == low]
    if len(exact) == 1:
        return exact[0]
    partial = [f for f in data["filings"] if low in f["title"].lower()]
    return partial[0] if len(partial) == 1 else None


def is_overdue(filing: dict, today: str | None = None) -> bool:
    """A filing is overdue iff its due date is past today and it isn't filed/done."""
    if str(filing.get("status", "")).lower() in DONE_STATUSES:
        return False
    d = (filing.get("dueDate") or "")[:10]
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
    answer (or a small candidate list to disambiguate).
    """
    q = (destination or "").strip().lower()
    if not q:
        return {"status": "not_found", "candidates": _all_destinations(data)[:8]}

    # 1) Exact static route path or title.
    for route in data["routes"]:
        if q == route["path"].lower() or q == route["title"].lower():
            return {"status": "resolved", "path": route["path"], "title": route["title"]}

    # 2) Filings by title (exact, then substring).
    f_exact = [f for f in data["filings"] if f["title"].lower() == q]
    if len(f_exact) == 1:
        f = f_exact[0]
        return {"status": "resolved", "path": filing_route(f["id"]), "title": f["title"]}

    # 3) Word-boundary / keyword matching across routes + filings. Deliberately NOT raw
    # bidirectional substring (a 1-2 char query like "x" must not match inside a word).
    def _word_in(needle: str, hay: str) -> bool:
        needle = needle.strip().lower()
        return bool(needle) and re.search(r"\b" + re.escape(needle) + r"\b", hay) is not None

    matches: list[dict] = []
    for route in data["routes"]:
        title = route["title"].lower()
        kws = [k.lower() for k in route.get("keywords", [])]
        if (len(q) >= 3 and q in title) or any(_word_in(kw, q) for kw in kws) or (len(q) >= 3 and any(q in kw for kw in kws)):
            matches.append({"path": route["path"], "title": route["title"]})
    for f in data["filings"]:
        if len(q) >= 3 and q in f["title"].lower():
            matches.append({"path": filing_route(f["id"]), "title": f["title"]})

    seen: set[str] = set()
    deduped = [m for m in matches if not (m["path"] in seen or seen.add(m["path"]))]

    if len(deduped) == 1:
        return {"status": "resolved", "path": deduped[0]["path"], "title": deduped[0]["title"]}
    if len(deduped) > 1:
        return {"status": "ambiguous", "candidates": deduped}
    return {"status": "not_found", "candidates": _all_destinations(data)[:8]}


def _all_destinations(data: dict) -> list[dict]:
    dests = [{"path": r["path"], "title": r["title"]} for r in data["routes"]]
    dests += [{"path": filing_route(f["id"]), "title": f["title"]} for f in data["filings"]]
    return dests


def new_id(prefix: str, existing: list[dict]) -> str:
    ids = {item["id"] for item in existing}
    n = len(existing) + 1
    while f"{prefix}-{n}" in ids:
        n += 1
    return f"{prefix}-{n}"
