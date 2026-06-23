"""FastAPI orchestrator — session CRUD, message streaming, and file upload.

Proxies all AI interactions to isolated session containers via SessionManager.
"""

import logging
import os
import time
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from api_auth import APIAuthenticator, AuthConfig
from session_manager import SessionManager
from trace_logging import setup_trace_logging, trace_event

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Globals set during lifespan
# ---------------------------------------------------------------------------
session_manager: SessionManager | None = None
content_processor = None  # ContentProcessor | None
api_authenticator: APIAuthenticator | None = None


def _trace_dir() -> str | None:
    if os.getenv("LOG_TRACE", "").lower() != "true":
        return None
    trace_dir = os.getenv("LOG_TRACE_DIR")
    if not trace_dir:
        return None
    return os.path.abspath(trace_dir)


def _raw_trace_dir() -> str | None:
    if os.getenv("LOG_RAW_SDK_EVENTS", "").lower() != "true":
        return None
    trace_dir = os.getenv("LOG_RAW_SDK_EVENTS_DIR") or os.getenv("LOG_TRACE_DIR")
    if not trace_dir:
        return None
    return os.path.abspath(trace_dir)


def _clear_trace_log_for_new_session() -> None:
    """Best-effort trace reset for local dev debugging.

    In local development the orchestrator and session container both write to the
    same trace file under LOG_TRACE_DIR. Truncating it on new session makes it
    easier to isolate a single browser run while leaving production behavior alone.
    """
    trace_dir = _trace_dir()
    if not trace_dir or os.getenv("POOL_MANAGEMENT_ENDPOINT", "").startswith("https://"):
        return

    path = os.path.join(trace_dir, "trace.jsonl")
    try:
        os.makedirs(trace_dir, exist_ok=True)
        with open(path, "w", encoding="utf-8"):
            pass
    except Exception:
        logger.warning("Failed to clear trace log for new session", exc_info=True)


def _raw_sdk_trace_path(session_id: str) -> str | None:
    trace_dir = _raw_trace_dir()
    if not trace_dir:
        return None
    return os.path.join(trace_dir, "sdk-events", f"{session_id}.jsonl")


def _clear_session_trace_artifacts(session_id: str) -> None:
    if os.getenv("POOL_MANAGEMENT_ENDPOINT", "").startswith("https://"):
        return

    trace_path = _raw_sdk_trace_path(session_id)
    if not trace_path:
        return

    try:
        os.makedirs(os.path.dirname(trace_path), exist_ok=True)
        with open(trace_path, "w", encoding="utf-8"):
            pass
    except Exception:
        logger.warning("Failed to clear raw SDK trace file for session %s", session_id, exc_info=True)


def _trace_paths_for_session(session_id: str) -> dict[str, str | None]:
    base = _trace_dir()
    return {
        "trace_log": os.path.join(base, "trace.jsonl") if base else None,
        "raw_sdk_trace": _raw_sdk_trace_path(session_id),
    }


@asynccontextmanager
async def lifespan(app: FastAPI):
    global session_manager, content_processor, api_authenticator

    # Content Processing (optional — ADLS + Content Understanding)
    from content_processing import ContentProcessor

    content_processor = ContentProcessor()
    try:
        await content_processor.initialize()
    except Exception:
        logger.warning("Content processing initialization failed — disabled", exc_info=True)
    if content_processor.enabled:
        logger.info("Content processing ready")
    else:
        logger.info("Content processing disabled (ADLS or CU not configured)")

    setup_trace_logging()
    api_authenticator = APIAuthenticator(AuthConfig.from_env())

    session_manager = SessionManager(content_processor)
    await session_manager.start()
    logger.info("Application started")

    yield

    await session_manager.stop()
    await content_processor.close()
    logger.info("Application shut down")


app = FastAPI(title="Tax Workbench Agent", lifespan=lifespan)

# CORS: allow localhost only in dev, plus configurable FRONTEND_URL for production
cors_origins = []
frontend_url = os.getenv("FRONTEND_URL")
if frontend_url:
    cors_origins.append(frontend_url)
else:
    # No FRONTEND_URL set — assume local development
    cors_origins.append("http://localhost:3000")

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["authorization", "content-type", "x-api-key"],
)


@app.middleware("http")
async def security_headers(request, call_next):
    response = await call_next(request)
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Content-Security-Policy"] = "frame-ancestors 'none'"
    return response


@app.middleware("http")
async def enforce_api_auth(request: Request, call_next):
    if api_authenticator is None:
        return JSONResponse(status_code=503, content={"detail": "Authentication not initialized."})
    rejection = await api_authenticator.authenticate(request)
    if rejection is not None:
        trace_event(
            "orchestrator",
            "auth.rejected",
            method=request.method,
            path=request.url.path,
            status=rejection.status_code,
            detail=rejection.body.decode("utf-8"),
        )
        return rejection
    return await call_next(request)


@app.middleware("http")
async def trace_requests(request: Request, call_next):
    t0 = time.monotonic()
    response = await call_next(request)
    trace_event(
        "orchestrator",
        "http.request",
        method=request.method,
        path=request.url.path,
        query=str(request.url.query),
        status=response.status_code,
        duration_s=round(time.monotonic() - t0, 4),
    )
    return response


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------
class SendMessageRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=50000)


# ---------------------------------------------------------------------------
# Session endpoints
# ---------------------------------------------------------------------------
@app.post("/sessions", status_code=201)
async def create_session() -> dict:
    """Create a new isolated agent session."""
    _clear_trace_log_for_new_session()
    metadata = await session_manager.create_session()
    _clear_session_trace_artifacts(metadata["session_id"])
    return metadata


@app.post("/sessions/{session_id}/messages")
async def send_message(session_id: str, req: SendMessageRequest) -> StreamingResponse:
    """Send a user message and stream back SSE events."""
    try:
        await session_manager.validate_session(session_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Session not found")

    return StreamingResponse(
        session_manager.send_message(session_id, req.prompt),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/sessions/{session_id}")
async def get_session(session_id: str) -> dict:
    """Check if a session is still active (used for session restore on reload)."""
    try:
        await session_manager.validate_session(session_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Session not found")
    files = (await session_manager.list_files(session_id)).get("files", [])
    return {"session_id": session_id, "status": "active", "files": files}


@app.delete("/sessions/{session_id}", status_code=204)
async def delete_session(session_id: str):
    """Delete a session."""
    try:
        await session_manager.validate_session(session_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Session not found")
    await session_manager.delete_session(session_id)


@app.get("/sessions/{session_id}/trace")
async def get_session_trace(session_id: str) -> dict:
    """Return local trace file locations for the current session."""
    try:
        await session_manager.validate_session(session_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Session not found")
    return {
        **_trace_paths_for_session(session_id),
    }


@app.get("/sessions/{session_id}/files")
async def list_files(session_id: str) -> dict:
    """List files in a session's workspace."""
    try:
        await session_manager.validate_session(session_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Session not found")

    try:
        return await session_manager.list_files(session_id)
    except Exception as exc:
        if isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code < 500:
            raise HTTPException(status_code=exc.response.status_code, detail="Failed to list files")
        raise


@app.get("/sessions/{session_id}/app/state")
async def get_app_state(session_id: str) -> dict:
    """Return the Tax Workbench application state for a session (rendered by the app pane)."""
    try:
        await session_manager.validate_session(session_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Session not found")

    try:
        return await session_manager.get_app_state(session_id)
    except Exception as exc:
        if isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code < 500:
            raise HTTPException(status_code=exc.response.status_code, detail="Failed to load app state")
        raise


@app.get("/sessions/{session_id}/files/content")
async def get_file_content(session_id: str, filename: str) -> dict:
    """Get text content for a workspace file."""
    try:
        await session_manager.validate_session(session_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Session not found")

    try:
        return await session_manager.get_file_content(session_id, filename)
    except Exception as exc:
        if isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code < 500:
            try:
                detail = exc.response.json().get("detail", "Request failed")
            except Exception:
                detail = "Request failed"
            raise HTTPException(status_code=exc.response.status_code, detail=detail)
        raise


class SaveContentRequest(BaseModel):
    filename: str
    content: str


@app.put("/sessions/{session_id}/files/content")
async def save_file_content(session_id: str, body: SaveContentRequest) -> dict:
    """Persist an in-app edit to an existing text artifact."""
    try:
        await session_manager.validate_session(session_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Session not found")
    try:
        return await session_manager.save_file_content(session_id, body.filename, body.content)
    except Exception as exc:
        if isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code < 500:
            try:
                detail = exc.response.json().get("detail", "Request failed")
            except Exception:
                detail = "Request failed"
            raise HTTPException(status_code=exc.response.status_code, detail=detail)
        raise


@app.post("/sessions/{session_id}/upload")
async def upload_file(session_id: str, file: UploadFile) -> dict:
    """Upload a document to a session's workspace."""
    try:
        await session_manager.validate_session(session_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Session not found")

    try:
        result = await session_manager.upload_file(session_id, file)
    except Exception as exc:
        if isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code < 500:
            try:
                detail = exc.response.json().get("detail", "Upload failed")
            except Exception:
                detail = "Upload failed"
            raise HTTPException(status_code=exc.response.status_code, detail=detail)
        raise
    return result


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------
@app.get("/health")
async def health() -> dict:
    """Return service health."""
    return {"status": "ok"}
