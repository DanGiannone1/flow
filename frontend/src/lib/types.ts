export type AGUIEvent =
  | { type: "RUN_STARTED"; thread_id: string; run_id: string }
  | { type: "TEXT_MESSAGE_START"; message_id: string; role: string }
  | { type: "TEXT_MESSAGE_CONTENT"; message_id: string; delta: string }
  | { type: "TEXT_MESSAGE_END"; message_id: string }
  | { type: "TOOL_CALL_START"; tool_call_id: string; tool_call_name: string; parent_message_id?: string }
  | { type: "TOOL_CALL_ARGS"; tool_call_id: string; delta: string }
  | { type: "TOOL_CALL_RESULT"; tool_call_id: string; outcome: ToolOutcome; candidates?: string[] }
  | { type: "TOOL_CALL_END"; tool_call_id: string }
  | { type: "RUN_FINISHED"; thread_id: string; run_id: string }
  | { type: "RUN_ERROR"; message: string };

export type ToolOutcome = "ok" | "noop" | "error";

export type MessagePart =
  | { type: "text"; content: string }
  | { type: "tool_call"; tool: string; toolCallId: string; status: "running" | "done"; args?: string; outcome?: ToolOutcome; candidates?: string[] };

export interface TurnMeta {
  steps: number;       // tool calls in the turn
  durationMs: number;  // wall-clock from run start to finish
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  isStreaming: boolean;
  parts: MessagePart[];
  meta?: TurnMeta;
}

export interface FileInfo {
  filename: string;
  size: number;
  modified_at: string;
  has_markdown: boolean;
  origin?: "uploaded" | "generated";
}

export interface AppFile {
  filename: string;
  size: number;
  modified_at: string;
  origin: "uploaded" | "generated";
  status: "pending" | "ready";
  has_markdown: boolean;
}

// ── Tax Workbench application state (rendered by the right-pane app) ──────────
// The app is a flat tax-filing tracker: the only record type is a Filing.
export interface TWChecklistItem {
  text: string;
  done: boolean;
}

export interface TWFiling {
  id: string;
  title: string;
  type: string;
  status: string;
  dueDate?: string;
  assignee?: string;
  checklist?: TWChecklistItem[];
  createdAt?: string;
}

export interface AppState {
  currentRoute: string;
  filings: TWFiling[];
  routes: { path: string; title: string; keywords?: string[] }[];
}
