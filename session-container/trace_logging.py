"""Shared trace helpers for the session container image.

Copied into the session-container context so the standalone session image can
import trace logging without depending on the orchestrator build context.
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


def _trace_enabled() -> bool:
    return os.getenv("LOG_TRACE", "").lower() == "true"


def _trace_path() -> Path | None:
    if not _trace_enabled():
        return None
    trace_dir = os.getenv("LOG_TRACE_DIR")
    if not trace_dir:
        return None
    return Path(trace_dir).resolve() / "trace.jsonl"


def setup_trace_logging() -> None:
    path = _trace_path()
    if not path:
        return
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
    except Exception:
        logger.warning("Failed to prepare trace directory", exc_info=True)


def trace_event(component: str, event: str, **data: Any) -> None:
    path = _trace_path()
    if not path:
        return
    payload = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "component": component,
        "event": event,
        **data,
    }
    try:
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(payload, ensure_ascii=True) + "\n")
    except Exception:
        logger.warning("Failed to write trace event", exc_info=True)
