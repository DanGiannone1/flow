"""AgentSession wrapping the GitHub Copilot SDK (1.0.x) with an event queue.

Provides a streaming async generator interface for running agent turns against
Azure OpenAI. Translates SDK session events into AG-UI protocol events.

The agent operates on a per-session workspace folder. Application state (the mock
"Tax Workbench" data) lives in a JSON doc in that workspace (see taxdb.py); the
tax tools read and mutate it, and the frontend renders it via /app/state.
"""

import asyncio
import json as _json
import logging as _logging
import os
import re as _re
import threading
import time as _time
import uuid
from collections.abc import AsyncGenerator
from pathlib import Path

from ag_ui.core.events import (
    BaseEvent,
    RunErrorEvent,
    RunFinishedEvent,
    RunStartedEvent,
    TextMessageContentEvent,
    TextMessageEndEvent,
    TextMessageStartEvent,
    ToolCallArgsEvent,
    ToolCallEndEvent,
    ToolCallStartEvent,
)
from azure.identity.aio import DefaultAzureCredential
from pydantic import BaseModel, Field
from dotenv import load_dotenv

from copilot import CopilotClient, SessionHooks, define_tool
from copilot.session import PermissionHandler
from copilot.session_events import (
    AssistantMessageData,
    AssistantMessageDeltaData,
    SessionErrorData,
    SessionIdleData,
    SessionInfoData,
    SkillInvokedData,
    ToolExecutionCompleteData,
    ToolExecutionStartData,
)

import taxdb

load_dotenv()

_LOG = os.getenv("LOG_AGENT_EVENTS", "").lower() == "true"
_logger = _logging.getLogger("agent.events")
_trace_logger = _logging.getLogger("trace")


def _log_event(msg: str) -> None:
    if _LOG:
        _logger.info(msg)


def _trace(event: str, **data) -> None:
    if not _trace_logger.handlers:
        return
    from datetime import datetime, timezone
    record = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "component": "session",
        "event": event,
        "data": data,
    }
    _trace_logger.info(_json.dumps(record, default=str))


SYSTEM_PROMPT = """\
You are Tax Assistant, the assistant embedded in Tax Workbench — a simple app for a
tax team to track their **filings** and draft **documents**. The app has three pages:
Dashboard (what's due), Filings (the tax returns / estimated payments / extensions /
provisions, each with a status, due date, assignee, and checklist), and Documents
(letters and memos you draft). You help by acting directly on the app through tools.

You operate inside the user's own session. The tools you call read and mutate the
*real* application state, and the user sees the result in the app next to this chat.
Only claim you did something after the tool that does it has returned successfully —
never say a record was created/updated or that you navigated unless the tool call succeeded.

How you work:
- Read the request, then take the single most direct action. Do not over-plan.
- For "take me to / go to / open / show me <place>" requests, call `navigate` with the
  user's destination words **verbatim**. Don't pre-resolve a vague phrase — pass it and
  let `navigate` decide. If it returns AMBIGUOUS, list the candidates and ask which one.
  If NOT_FOUND, say so and list the closest options. Never claim you navigated unless the
  tool resolved a destination.
- Filings are the core records. Use `list_filings` to review (it returns a computed
  `overdue` flag and each filing's checklist progress), `create_filing` to add one,
  `update_filing` to change status/assignee/due date, and `add_checklist_item` to add a step.
- For "what's overdue", use the `overdue` flag from `list_filings` and the "[Today: …]"
  context — never judge dates yourself.
- To write or revise a document (engagement letter, memo, summary), use `write_file` — it
  appears in Documents and opens in the artifact canvas, where the user can edit it. To read
  an existing document first, use `list_documents` then `read_workspace_file`.

The user's current view may be provided as context (e.g. "[Current view: Filings]"). Use it
to resolve "here" / "this". The current date is provided as "[Today: …]".

Style:
- Be concise and professional. One or two sentences is usually enough.
- State concretely what you did ("Created the Q3 estimated-payment filing" / "Opened the
  Form 1120 filing" / "Drafted the engagement letter").
- Don't mention tools, routes, file paths, or IDs unless asked. Don't invent data the tools
  didn't return.
- Stay in your lane: you're the Tax Workbench assistant. For clearly off-topic requests
  (general trivia, unrelated coding), don't answer at length — briefly redirect ("I'm focused
  on your tax workbench — want me to look at your filings or a document?").
"""


def _sse_event(event: BaseEvent) -> str:
    """Format an AG-UI event as an SSE data line."""
    return f"data: {event.model_dump_json(exclude_none=True)}\n\n"


def _jsonable(value):
    """Best-effort conversion of SDK event payloads into JSON-safe structures."""
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, dict):
        return {str(k): _jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_jsonable(v) for v in value]
    model_dump = getattr(value, "model_dump", None)
    if callable(model_dump):
        try:
            return _jsonable(model_dump())
        except Exception:
            pass
    if hasattr(value, "__dict__"):
        try:
            return {
                str(k): _jsonable(v)
                for k, v in vars(value).items()
                if not str(k).startswith("_")
            }
        except Exception:
            pass
    return repr(value)


def _args_to_str(args) -> str | None:
    if args is None:
        return None
    if isinstance(args, str):
        return args
    try:
        return _json.dumps(_jsonable(args))
    except Exception:
        return str(args)


def _result_text(result) -> str:
    """Extract the tool's returned text from the SDK result.

    The SDK delivers tool results as a `ToolExecutionCompleteResult` object (or a
    dict) carrying the tool's string under `content` — NOT a bare string. Pull the
    text out of any of these shapes so outcome classification reads the real marker
    (e.g. "AMBIGUOUS"), not a repr of the wrapper object.
    """
    if isinstance(result, str):
        return result
    if isinstance(result, dict):
        for key in ("content", "text", "detailed_content"):
            val = result.get(key)
            if isinstance(val, str) and val:
                return val
        return ""
    for attr in ("content", "text", "detailed_content"):
        val = getattr(result, attr, None)
        if isinstance(val, str) and val:
            return val
    return str(result or "")


_NOOP_MARKERS = {"AMBIGUOUS", "NO_CHANGES", "NO_DOCUMENTS"}
_ERROR_MARKERS = {"INVALID_PATH", "FILE_NOT_FOUND", "BINARY_FILE_UNSUPPORTED", "PATH_REQUIRED", "ENCODING_UNSUPPORTED", "TITLE_REQUIRED", "TEXT_REQUIRED"}


def _tool_outcome(result, success) -> str:
    """Classify a tool result as ok | noop | error so the UI trace reflects reality.

    Classify ONLY on the leading status marker our tools emit (NAVIGATED / CREATED /
    AMBIGUOUS / *_NOT_FOUND / ...). We deliberately do NOT scan the whole result body
    — document/template content returned by read/get tools could otherwise contain a
    marker word and flip a real success to a false error. Keeps the trace honest.
    """
    text = _result_text(result).strip()
    head = text.split(None, 1)[0].rstrip(":") if text else ""
    if head in _NOOP_MARKERS:
        return "noop"
    if head in _ERROR_MARKERS or head.endswith("NOT_FOUND"):
        return "error"
    if success is False:
        return "error"
    # Fail loud: an empty result with no positive marker is not a real success —
    # don't show a green check for a tool that produced nothing.
    if not text:
        return "error"
    return "ok"


def _nav_candidates(result) -> list[str]:
    """Pull candidate destination titles out of a navigate AMBIGUOUS/NOT_FOUND result
    so the UI can offer them as one-click chips."""
    text = _result_text(result)
    marker = "destinations: " if "destinations: " in text else ("options: " if "options: " in text else None)
    if not marker:
        return []
    tail = text.split(marker, 1)[1]
    tail = tail.split(". ", 1)[0].rstrip(".")
    # Candidates are joined with "; " by the navigate tool — split on that only
    # (splitting on the word "and" would fragment titles like "Research and Development").
    parts = [p.strip() for p in tail.split(";") if p.strip()]
    return [p for p in parts if p and not p.lower().startswith("ask ")][:6]


def _normalize_assignee(raw: str) -> str:
    """Map first-person references to the current practitioner label so the
    assignee column never reads a literal 'me'/'myself'."""
    a = (raw or "").strip()
    if a.lower() in ("me", "myself", "i", "to me"):
        return "You"
    return a or "Unassigned"


def _path_within_workspace(workspace: Path, candidate: Path) -> bool:
    try:
        candidate.relative_to(workspace)
        return True
    except ValueError:
        return False


def _normalize_workspace_text(text: str) -> str:
    text = _re.sub(r"<!--\s*Page(?:Header|Footer|Break|Number)[^>]*-->", "", text, flags=_re.IGNORECASE)
    text = _re.sub(r"!\[[^\]]*]\([^)]+\)", "", text)
    text = _re.sub(r"\n{3,}", "\n\n", text)
    return text.strip() + ("\n" if text.strip() else "")


# ── Tool parameter models ───────────────────────────────────────────────────

class ReadFileParams(BaseModel):
    path: str = Field(
        default="",
        description=(
            "Optional path to a UTF-8 text or markdown file in the workspace. If omitted "
            "and there is exactly one uploaded file, that file is read."
        ),
    )


class WriteFileParams(BaseModel):
    path: str = Field(description="Path to a UTF-8 text or markdown artifact in the workspace")
    content: str = Field(description="Complete text content to write to the file")


class ListDocumentsParams(BaseModel):
    pass


class NavigateParams(BaseModel):
    destination: str = Field(
        description="Where to go, as the user phrased it — a page ('Filings', 'Documents', 'Dashboard') or a filing title (e.g. '2025 Federal Form 1120')."
    )


class ListFilingsParams(BaseModel):
    pass


class CreateFilingParams(BaseModel):
    title: str = Field(description="Filing title, e.g. '2025 Federal Form 1120' or 'Q3 2026 Federal Estimated Payment'")
    type: str = Field(default="Filing", description="Filing type, e.g. 'Federal return', 'State return', 'Estimated payment', 'Extension', 'Provision'")
    due_date: str = Field(default="", description="Due date (YYYY-MM-DD), if known")
    assignee: str = Field(default="", description="Assignee name, if known")


class UpdateFilingParams(BaseModel):
    filing: str = Field(description="Filing id or a distinctive part of its title")
    status: str = Field(default="", description="New status: 'Not started', 'In progress', 'In review', or 'Filed'")
    assignee: str = Field(default="", description="New assignee")
    due_date: str = Field(default="", description="New due date (YYYY-MM-DD)")


class AddChecklistItemParams(BaseModel):
    filing: str = Field(description="Filing id or a distinctive part of its title")
    text: str = Field(description="The checklist item to add")


# ── Tool builders (closures over the session workspace) ─────────────────────

def _build_tax_tools(working_dir: str) -> list:
    workspace_root = Path(working_dir).resolve()

    def _load() -> dict:
        return taxdb.load(str(workspace_root))

    def _save(data: dict) -> None:
        taxdb.save(str(workspace_root), data)

    @define_tool(name="navigate", description="Navigate the Tax Workbench app to a page or work area.")
    def navigate(params: NavigateParams) -> str:
        data = _load()
        result = taxdb.resolve_destination(data, params.destination)
        if result["status"] == "resolved":
            data["currentRoute"] = result["path"]
            _save(data)
            return f"NAVIGATED to {result['title']} ({result['path']})"
        if result["status"] == "ambiguous":
            opts = "; ".join(c["title"] for c in result["candidates"])
            return f"AMBIGUOUS: '{params.destination}' matches multiple destinations: {opts}. Ask the user which one."
        opts = "; ".join(c["title"] for c in result["candidates"])
        return f"NOT_FOUND: no destination matched '{params.destination}'. Closest options: {opts}."

    @define_tool(name="list_filings", description="List the tax filings (returns, estimates, extensions, provisions) with their type, status, due date, assignee, and a computed overdue flag.")
    def list_filings(params: ListFilingsParams) -> str:
        data = _load()
        filings = data["filings"]
        if not filings:
            return "No filings yet."
        from datetime import datetime, timezone
        today = datetime.now(timezone.utc).date().isoformat()
        n_over = sum(1 for f in filings if taxdb.is_overdue(f, today))
        lines = [f"{len(filings)} filing(s) | today={today} | overdue={n_over}:"]
        for f in filings:
            cl = f.get("checklist") or []
            done = sum(1 for c in cl if c.get("done"))
            lines.append(
                f"- [{f['id']}] {f['title']} | type={f.get('type') or 'Filing'} | status={f['status']} | "
                f"due={f.get('dueDate') or 'n/a'} | overdue={'yes' if taxdb.is_overdue(f, today) else 'no'} | "
                f"assignee={f.get('assignee') or 'Unassigned'} | checklist={done}/{len(cl)}"
            )
        return "\n".join(lines)

    @define_tool(name="create_filing", description="Create a tax filing (a return, estimated payment, extension, or provision) in the tracker.")
    def create_filing(params: CreateFilingParams) -> str:
        if not params.title.strip():
            return "TITLE_REQUIRED: a filing needs a title."
        data = _load()
        filing = {
            "id": taxdb.new_id("f", data["filings"]),
            "title": params.title.strip(),
            "type": params.type.strip() or "Filing",
            "status": "Not started",
            "dueDate": params.due_date.strip(),
            "assignee": _normalize_assignee(params.assignee),
            "checklist": [],
            "createdAt": taxdb._now_iso(),
        }
        data["filings"].append(filing)
        data["currentRoute"] = taxdb.filing_route(filing["id"])
        _save(data)
        return (
            f"CREATED filing [{filing['id']}] '{filing['title']}' ({filing['type']}), "
            f"status {filing['status']}, due {filing['dueDate'] or 'n/a'}, assignee {filing['assignee']}."
        )

    @define_tool(name="update_filing", description="Update a filing's status, assignee, or due date.")
    def update_filing(params: UpdateFilingParams) -> str:
        data = _load()
        ref = params.filing.strip().lower()
        # Prefer an exact id/title hit; only fall back to substring so a stray substring
        # can't silently target the wrong filing.
        exact = [f for f in data["filings"] if f["id"].lower() == ref or f["title"].lower() == ref]
        matches = exact if exact else [f for f in data["filings"] if ref in f["title"].lower()]
        if not matches:
            return f"FILING_NOT_FOUND: '{params.filing}'."
        if len(matches) > 1:
            opts = "; ".join(f"[{f['id']}] {f['title']}" for f in matches)
            return f"AMBIGUOUS filing '{params.filing}': {opts}. Ask which one."
        f = matches[0]
        changed = []
        if params.status.strip():
            f["status"] = params.status.strip()
            changed.append(f"status={f['status']}")
        if params.assignee.strip():
            f["assignee"] = _normalize_assignee(params.assignee)
            changed.append(f"assignee={f['assignee']}")
        if params.due_date.strip():
            f["dueDate"] = params.due_date.strip()
            changed.append(f"due={f['dueDate']}")
        if not changed:
            return "NO_CHANGES: specify a status, assignee, or due_date to update."
        data["currentRoute"] = taxdb.filing_route(f["id"])
        _save(data)
        return f"UPDATED filing [{f['id']}] '{f['title']}': {', '.join(changed)}."

    @define_tool(name="add_checklist_item", description="Add a checklist step to a filing.")
    def add_checklist_item(params: AddChecklistItemParams) -> str:
        text = params.text.strip()
        if not text:
            return "TEXT_REQUIRED: provide the checklist item text."
        data = _load()
        f = taxdb.resolve_filing(data, params.filing)
        if not f:
            return f"FILING_NOT_FOUND: '{params.filing}'."
        f.setdefault("checklist", []).append({"text": text, "done": False})
        data["currentRoute"] = taxdb.filing_route(f["id"])
        _save(data)
        return f"ADDED checklist item to '{f['title']}': {text}."

    @define_tool(name="list_documents", description="List the documents available in the workspace (provided source documents and generated artifacts) with a one-line descriptor. Use to discover what you can read before answering document questions.")
    def list_documents(params: ListDocumentsParams) -> str:
        docs = []
        for p in sorted(workspace_root.iterdir()):
            if not p.is_file() or p.name.startswith("."):
                continue
            descriptor = ""
            try:
                # Read line-by-line and stop at the first descriptor — don't slurp whole
                # (possibly multi-MB) files just to grab one line.
                with p.open(encoding="utf-8") as fh:
                    for line in fh:
                        s = line.strip().lstrip("#").strip()
                        if s:
                            descriptor = s[:100]
                            break
            except (UnicodeDecodeError, OSError):
                descriptor = "(non-text file)"
            docs.append(f"- {p.name} — {descriptor}" if descriptor else f"- {p.name}")
        if not docs:
            return "NO_DOCUMENTS: the workspace has no documents yet."
        return "Documents in the workspace:\n" + "\n".join(docs)

    @define_tool(name="read_workspace_file", description="Read a complete UTF-8 text or markdown file (e.g. an uploaded document) from the workspace.")
    def read_workspace_file(params: ReadFileParams) -> str:
        raw_path = params.path.strip()
        if raw_path:
            candidate = Path(raw_path)
            resolved = (candidate if candidate.is_absolute() else workspace_root / candidate).resolve()
        else:
            visible = [
                p.resolve() for p in sorted(workspace_root.iterdir())
                if p.is_file() and not p.name.startswith(".")
            ]
            if len(visible) != 1:
                return f"PATH_REQUIRED: workspace has {len(visible)} files: {[p.name for p in visible]}"
            resolved = visible[0]
            raw_path = resolved.name
        if not _path_within_workspace(workspace_root, resolved):
            return "INVALID_PATH: must stay within the workspace"
        if not resolved.exists() or not resolved.is_file():
            return f"FILE_NOT_FOUND: {raw_path}"
        raw_bytes = resolved.read_bytes()
        if b"\x00" in raw_bytes:
            return f"BINARY_FILE_UNSUPPORTED: {raw_path}"
        try:
            decoded = raw_bytes.decode("utf-8")
        except UnicodeDecodeError:
            # Fail loud: never feed silently-mangled (U+FFFD-substituted) content to
            # the model, which would then assert facts grounded in corrupted text.
            return f"ENCODING_UNSUPPORTED: {raw_path} is not valid UTF-8 text."
        text = _normalize_workspace_text(decoded)
        return f"PATH: {resolved.name}\n\n{text}"

    @define_tool(name="write_file", description="Write a complete UTF-8 text or markdown artifact (e.g. a generated summary) to the workspace.")
    def write_file(params: WriteFileParams) -> str:
        raw_path = params.path.strip()
        if not raw_path:
            return "PATH_REQUIRED"
        candidate = Path(raw_path)
        resolved = (candidate if candidate.is_absolute() else workspace_root / candidate).resolve()
        if not _path_within_workspace(workspace_root, resolved):
            return "INVALID_PATH: must stay within the workspace"
        if resolved.name.startswith("."):
            return "INVALID_PATH: hidden files are not valid output targets"
        resolved.parent.mkdir(parents=True, exist_ok=True)
        resolved.write_text(params.content, encoding="utf-8")
        return f"WROTE {resolved.name} ({resolved.stat().st_size} bytes)."

    return [
        navigate, list_filings, create_filing, update_filing, add_checklist_item,
        list_documents, read_workspace_file, write_file,
    ]


# Internal tool names never surfaced to the frontend (the "skill" tool is handled
# separately via SkillInvokedData). Empty today; kept for easy extension.
_HIDDEN_TOOLS: set[str] = set()


class AgentSession:
    """Async context manager holding a persistent Copilot session (SDK 1.0.x)."""

    def __init__(self, working_dir: str, token: str | None = None, session_id: str = "default"):
        self._working_dir = working_dir
        self._initial_token = token
        self._token = token
        self._session_id = session_id
        self._client: CopilotClient | None = None
        self._session = None
        self._unsubscribe = None
        self._queue: asyncio.Queue[BaseEvent | None] = asyncio.Queue()
        self._loop: asyncio.AbstractEventLoop | None = None
        self._tool_names: dict[str, tuple[str, float]] = {}
        self._tools_called: int = 0
        self._turn_start: float = 0.0
        self._status: str = "idle"
        self._turn_active: bool = False
        self._credential: DefaultAzureCredential | None = None

        self._thread_id: str = str(uuid.uuid4())
        self._run_id: str = ""
        self._current_message_id: str = ""
        self._message_started: bool = False

        self._raw_sdk_log_lock = threading.Lock()
        self._raw_sdk_log_path: str | None = None
        if os.getenv("LOG_RAW_SDK_EVENTS", "").lower() == "true":
            logs_dir = os.getenv("LOG_RAW_SDK_EVENTS_DIR") or os.getenv("LOG_TRACE_DIR")
            if logs_dir:
                raw_dir = Path(logs_dir) / "sdk-events"
                raw_dir.mkdir(parents=True, exist_ok=True)
                self._raw_sdk_log_path = str(raw_dir / f"{self._session_id}.jsonl")

    @property
    def raw_sdk_log_path(self) -> str | None:
        return self._raw_sdk_log_path

    def _write_raw_sdk_record(self, record: dict) -> None:
        if not self._raw_sdk_log_path:
            return
        from datetime import datetime, timezone
        payload = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "session_id": self._session_id,
            **record,
        }
        line = _json.dumps(payload, default=str)
        with self._raw_sdk_log_lock:
            with open(self._raw_sdk_log_path, "a", encoding="utf-8") as f:
                f.write(line + "\n")

    @property
    def status(self) -> str:
        return self._status

    @property
    def token(self) -> str | None:
        return self._token

    async def __aenter__(self) -> "AgentSession":
        if self._raw_sdk_log_path:
            Path(self._raw_sdk_log_path).write_text("", encoding="utf-8")

        token = self._token or self._initial_token or os.getenv("AZURE_OPENAI_TOKEN")
        if not token:
            self._credential = DefaultAzureCredential()
            tok = await self._credential.get_token("https://cognitiveservices.azure.com/.default")
            token = tok.token
        self._token = token

        self._client = CopilotClient(use_logged_in_user=False)
        await self._client.start()
        self._loop = asyncio.get_running_loop()

        skills_dir = str(Path(__file__).parent / "skills")
        custom_tools = _build_tax_tools(self._working_dir)
        available_tools = [t.name for t in custom_tools] + ["skill"]

        provider = {
            "type": "azure",
            "base_url": os.environ["AZURE_ENDPOINT"],
            "bearer_token": token,
            "wire_api": "completions",
            "azure": {"api_version": os.getenv("AZURE_API_VERSION", "2024-10-21")},
        }

        self._session = await self._client.create_session(
            model=os.environ["AZURE_DEPLOYMENT"],
            provider=provider,
            system_message={"mode": "replace", "content": SYSTEM_PROMPT},
            working_directory=self._working_dir,
            tools=custom_tools,
            available_tools=available_tools,
            streaming=True,
            skip_custom_instructions=True,
            enable_skills=True,
            skill_directories=[skills_dir],
            on_permission_request=PermissionHandler.approve_all,
            hooks=SessionHooks(on_pre_tool_use=self._pre_tool_use),
            on_event=self._on_event,
        )

        _trace(
            "agent.session_initialized",
            session_id=self._session_id,
            working_dir=self._working_dir,
            model=os.environ.get("AZURE_DEPLOYMENT"),
            available_tools=available_tools,
            skill_directories=[skills_dir],
        )
        self._write_raw_sdk_record({"kind": "session_initialized", "available_tools": available_tools})
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        if self._session:
            try:
                await self._session.disconnect()
            except Exception:
                _logger.warning("session disconnect failed", exc_info=True)
        if self._client:
            await self._client.stop()
        if self._credential:
            await self._credential.close()

    async def _pre_tool_use(self, hook_input, _context):
        """Trace tool calls before execution. Permission is handled by approve_all.

        The SDK calls this as ``handler(input_dict, {"session_id": ...})``; ``input_dict``
        is a TypedDict-shaped dict with ``toolName`` / ``toolArgs`` keys.
        """
        _trace(
            "agent.pre_tool_use",
            session_id=self._session_id,
            run_id=self._run_id,
            tool=hook_input.get("toolName") if isinstance(hook_input, dict) else None,
            args=_jsonable(hook_input.get("toolArgs") if isinstance(hook_input, dict) else None),
        )
        return {"permissionDecision": "allow"}

    def _enqueue(self, event: BaseEvent) -> None:
        self._loop.call_soon_threadsafe(self._queue.put_nowait, event)

    def _enqueue_sse(self, payload: dict) -> None:
        """Enqueue an already-formatted SSE line (for custom AG-UI-style events)."""
        self._loop.call_soon_threadsafe(self._queue.put_nowait, f"data: {_json.dumps(payload)}\n\n")

    def _finish(self) -> None:
        self._turn_active = False
        self._loop.call_soon_threadsafe(self._queue.put_nowait, None)

    def _on_event(self, event) -> None:
        """Translate SDK session events (1.0.x *Data classes) into AG-UI events."""
        data = getattr(event, "data", None)
        self._write_raw_sdk_record(
            {
                "kind": "sdk_event",
                "run_id": self._run_id,
                "event_type": type(data).__name__ if data is not None else str(getattr(event, "type", "?")),
                "data": _jsonable(data),
            }
        )

        if isinstance(data, AssistantMessageDeltaData):
            self._status = "thinking"
            delta = data.delta_content or ""
            if not delta:
                return
            if not self._message_started:
                self._current_message_id = str(uuid.uuid4())
                self._message_started = True
                self._enqueue(TextMessageStartEvent(message_id=self._current_message_id, role="assistant"))
            self._enqueue(TextMessageContentEvent(message_id=self._current_message_id, delta=delta))

        elif isinstance(data, AssistantMessageData):
            final = data.content or ""
            if not self._message_started and final:
                self._current_message_id = str(uuid.uuid4())
                self._message_started = True
                self._enqueue(TextMessageStartEvent(message_id=self._current_message_id, role="assistant"))
                self._enqueue(TextMessageContentEvent(message_id=self._current_message_id, delta=final))
            if self._message_started:
                self._enqueue(TextMessageEndEvent(message_id=self._current_message_id))
                self._message_started = False

        elif isinstance(data, ToolExecutionStartData):
            tool = data.tool_name or "tool"
            call_id = data.tool_call_id or str(uuid.uuid4())
            self._tool_names[call_id] = (tool, _time.monotonic())
            if tool in _HIDDEN_TOOLS or tool == "skill":
                return
            self._status = f"tool:{tool}"
            self._enqueue(ToolCallStartEvent(
                tool_call_id=call_id,
                tool_call_name=tool,
                parent_message_id=self._current_message_id or None,
            ))
            args_str = _args_to_str(data.arguments)
            if args_str:
                self._enqueue(ToolCallArgsEvent(tool_call_id=call_id, delta=args_str))
            _trace("agent.tool_start", session_id=self._session_id, run_id=self._run_id, tool=tool, call_id=call_id, args=args_str)

        elif isinstance(data, ToolExecutionCompleteData):
            call_id = data.tool_call_id
            entry = self._tool_names.pop(call_id, None) if call_id else None
            tool = entry[0] if entry else "tool"
            if tool in _HIDDEN_TOOLS or tool == "skill":
                return
            self._status = "thinking"
            self._tools_called += 1
            result = getattr(data, "result", None)
            outcome = _tool_outcome(result, getattr(data, "success", None))
            if call_id:
                # Carry the real outcome so the UI trace reflects what happened
                # (e.g. an ambiguous navigation is NOT shown as a success).
                payload = {"type": "TOOL_CALL_RESULT", "tool_call_id": call_id, "outcome": outcome}
                if tool == "navigate" and outcome != "ok":
                    cands = _nav_candidates(result)
                    if cands:
                        payload["candidates"] = cands
                self._enqueue_sse(payload)
                self._enqueue(ToolCallEndEvent(tool_call_id=call_id))
            _trace("agent.tool_end", session_id=self._session_id, run_id=self._run_id, tool=tool, call_id=call_id, success=getattr(data, "success", None), outcome=outcome)

        elif isinstance(data, SkillInvokedData):
            # Surface skill loads as a lightweight step so the user-facing trace shows them.
            call_id = str(uuid.uuid4())
            self._enqueue(ToolCallStartEvent(
                tool_call_id=call_id,
                tool_call_name="skill",
                parent_message_id=self._current_message_id or None,
            ))
            self._enqueue(ToolCallArgsEvent(tool_call_id=call_id, delta=_json.dumps({"name": data.name})))
            self._enqueue(ToolCallEndEvent(tool_call_id=call_id))
            _trace("agent.skill_invoked", session_id=self._session_id, run_id=self._run_id, skill=data.name)

        elif isinstance(data, SessionInfoData):
            _trace("agent.session_info", session_id=self._session_id, run_id=self._run_id, info_type=getattr(data, "info_type", None), message=getattr(data, "message", None))

        elif isinstance(data, SessionIdleData):
            self._status = "idle"
            _trace("agent.turn_end", session_id=self._session_id, run_id=self._run_id, tools_called=self._tools_called)
            self._enqueue(RunFinishedEvent(thread_id=self._thread_id, run_id=self._run_id))
            self._finish()

        elif isinstance(data, SessionErrorData):
            self._status = "error"
            msg = getattr(data, "message", None) or "Unknown error"
            low = msg.lower()
            if "too many requests" in low or "429" in msg or "rate limit" in low:
                msg = "The AI service is temporarily rate-limited. Please wait 30–60 seconds and try again."
            elif "content management policy" in low or "content_filter" in low or "responsible ai" in low or "filtered" in low:
                # Surface a contained, on-brand refusal instead of leaking the raw Azure 400 +
                # support URL — the request tripped a safety filter; we decline plainly.
                msg = "I can't act on that request — it was flagged by the safety filter. I won't take actions that try to override my guardrails or operate outside your workspace."
            _trace("agent.error", session_id=self._session_id, run_id=self._run_id, message=msg)
            self._enqueue(RunErrorEvent(message=msg))
            self._enqueue(RunFinishedEvent(thread_id=self._thread_id, run_id=self._run_id))
            self._finish()

    async def send(self, prompt: str) -> AsyncGenerator[str, None]:
        """Send a prompt; yield SSE-formatted AG-UI events until the session is idle."""
        while not self._queue.empty():
            self._queue.get_nowait()

        self._run_id = str(uuid.uuid4())
        self._current_message_id = ""
        self._message_started = False
        self._tools_called = 0
        self._tool_names.clear()
        self._turn_start = _time.monotonic()
        self._status = "thinking"
        self._turn_active = True

        _trace("agent.turn_start", session_id=self._session_id, run_id=self._run_id)
        self._write_raw_sdk_record({"kind": "turn_start", "run_id": self._run_id, "prompt": prompt})

        yield _sse_event(RunStartedEvent(thread_id=self._thread_id, run_id=self._run_id))

        try:
            await self._session.send(prompt)
            while True:
                item = await self._queue.get()
                if item is None:
                    break
                yield item if isinstance(item, str) else _sse_event(item)
        except Exception as exc:
            self._write_raw_sdk_record({"kind": "turn_exception", "run_id": self._run_id, "error": repr(exc)})
            raise
        finally:
            # If the consumer was torn down mid-turn (client abort / new chat / timeout),
            # the SDK turn is still running on its own thread and its tools would keep
            # mutating the workspace. Interrupt it so Stop/New-Chat actually stop work.
            if self._turn_active and self._session is not None:
                try:
                    self._session.abort()
                except Exception:
                    _logger.warning("session abort failed", exc_info=True)
                self._turn_active = False
            self._write_raw_sdk_record({"kind": "turn_finalized", "run_id": self._run_id, "status": self._status})
