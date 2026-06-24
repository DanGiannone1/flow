"""Background reminder scheduler for the orchestrator.

Runs due reminders on a cadence and emails their output. Reuses the session
container's `appdb` (the single owner Cosmos doc is the source of truth for schedule
state + cadence math) and the orchestrator's `SessionManager` to run each saved prompt
as a headless agent turn — the agent produces the content, the scheduler delivers it.

The scheduler is the *only* always-on piece; in production this loop is replaced by an
ACA Job on a cron hitting the same `run_due_once`.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

# Reuse the session-container appdb — single source of truth for schedules + cadence.
# (Requires azure-cosmos in the orchestrator venv; the import is intentional, not a copy.)
_SC = Path(__file__).resolve().parent / "session-container"
if str(_SC) not in sys.path:
    sys.path.insert(0, str(_SC))
import appdb  # noqa: E402

import email_acs  # noqa: E402

logger = logging.getLogger(__name__)

TICK_SECONDS = int(os.getenv("SCHEDULER_TICK_SECONDS", "60"))


def _parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value)
    except ValueError:
        return None
    # Treat naive timestamps as UTC so comparisons are always tz-aware.
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


async def _run_prompt(session_manager, prompt: str) -> str:
    """Run `prompt` as a one-off headless agent turn; return the assistant's text."""
    meta = await session_manager.create_session()
    sid = meta["session_id"]
    parts: list[str] = []
    try:
        async for chunk in session_manager.send_message(sid, prompt):
            for line in chunk.splitlines():
                line = line.strip()
                if not line.startswith("data:"):
                    continue
                try:
                    obj = json.loads(line[len("data:"):].strip())
                except json.JSONDecodeError:
                    continue
                if obj.get("type") == "TEXT_MESSAGE_CONTENT":
                    parts.append(obj.get("delta", ""))
    finally:
        try:
            await session_manager.delete_session(sid)
        except Exception:
            logger.warning("scheduler: failed to clean up session %s", sid, exc_info=True)
    return "".join(parts).strip()


async def run_due_once(session_manager, *, now: datetime | None = None) -> int:
    """Run every reminder whose nextRunAt is due. Returns the count emailed."""
    now = now or datetime.now(timezone.utc)
    data = appdb.load()
    due = [
        s for s in data.get("schedules", [])
        if s.get("enabled") and (dt := _parse_iso(s.get("nextRunAt"))) and dt <= now
    ]
    emailed = 0
    for s in due:
        status = "ok"
        try:
            body = await _run_prompt(session_manager, s["prompt"]) or "(no content produced)"
            recipient = os.getenv("REMINDER_EMAIL", "")
            msg_id = await asyncio.to_thread(email_acs.send_email, recipient, s["title"], body)
            logger.info("scheduler: emailed reminder %s (acs id=%s)", s["id"], msg_id)
            emailed += 1
        except Exception as exc:
            status = f"error: {exc}"
            logger.error("scheduler: reminder %s failed: %s", s["id"], exc, exc_info=True)

        # Reload before write to minimize clobbering a concurrent agent turn (last-write-wins).
        fresh = appdb.load()
        cur = appdb.find_schedule(fresh, s["id"])
        if cur is None:  # deleted mid-run
            continue
        cur["lastRunAt"] = now.isoformat()
        cur["lastStatus"] = status[:240]
        try:
            cur["nextRunAt"] = appdb.compute_next_run(
                cur["frequency"], cur["time"], cur.get("timezone", "UTC"),
                cur.get("daysOfWeek"), after=now,
            ).isoformat()
        except Exception:
            logger.error("scheduler: cannot reschedule %s — disabling it", s["id"], exc_info=True)
            cur["enabled"] = False
        appdb.save(fresh)
    return emailed


async def scheduler_loop(session_manager) -> None:
    """Tick forever, running due reminders each interval."""
    logger.info("Reminder scheduler started (tick=%ss)", TICK_SECONDS)
    while True:
        try:
            await run_due_once(session_manager)
        except asyncio.CancelledError:
            logger.info("Reminder scheduler stopped")
            raise
        except Exception:
            logger.error("scheduler tick failed", exc_info=True)
        await asyncio.sleep(TICK_SECONDS)
