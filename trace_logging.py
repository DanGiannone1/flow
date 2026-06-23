"""Shared JSONL trace logging helpers for local debugging."""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any

_TRACE_LOGGER = logging.getLogger("trace")


def setup_trace_logging() -> None:
    """Configure the shared trace logger once per process."""
    if _TRACE_LOGGER.handlers:
        return

    trace_dir = os.getenv("LOG_TRACE_DIR")
    if os.getenv("LOG_TRACE", "").lower() != "true" or not trace_dir:
        return

    Path(trace_dir).mkdir(parents=True, exist_ok=True)
    handler = RotatingFileHandler(
        Path(trace_dir) / "trace.jsonl",
        maxBytes=50 * 1024 * 1024,
        backupCount=1,
    )
    handler.setFormatter(logging.Formatter("%(message)s"))
    _TRACE_LOGGER.addHandler(handler)
    _TRACE_LOGGER.setLevel(logging.INFO)
    _TRACE_LOGGER.propagate = False


def trace_event(component: str, event: str, **data: Any) -> None:
    """Write one structured trace record if tracing is enabled."""
    if not _TRACE_LOGGER.handlers:
        return

    record = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "component": component,
        "event": event,
        "data": data,
    }
    _TRACE_LOGGER.info(json.dumps(record, default=str))
