"use client";

import { CheckCircle2, Activity, HelpCircle, AlertCircle, Sparkles, Circle } from "lucide-react";
import { MessagePart, ToolOutcome } from "@/lib/types";

function runningLabel(name: string): string {
  const labels: Record<string, string> = {
    navigate: "Navigating", create_filing: "Creating filing", update_filing: "Updating filing",
    add_checklist_item: "Adding checklist step", list_filings: "Reviewing filings",
    list_documents: "Browsing documents",
    read_workspace_file: "Reading document", write_file: "Saving document", skill: "Loading skill",
  };
  return labels[name] || "Working";
}

// outcome may be undefined if the result signal was lost — fail closed: show a
// neutral "Done", never a green success, so the trace never overclaims.
function doneLabel(name: string, outcome: ToolOutcome | undefined): string {
  if (name === "skill") return "Skill loaded";  // skill loads carry no outcome by design
  if (outcome === "noop") {
    return ({ navigate: "Needs clarification", update_filing: "No changes" } as Record<string, string>)[name] || "No change";
  }
  if (outcome === "error") {
    return ({ navigate: "Destination not found", update_filing: "Filing not found", add_checklist_item: "Filing not found", create_filing: "Couldn't create filing" } as Record<string, string>)[name] || "Couldn't complete";
  }
  if (outcome === undefined) return "Done";
  const labels: Record<string, string> = {
    navigate: "Navigated", create_filing: "Filing created", update_filing: "Filing updated",
    add_checklist_item: "Checklist step added", list_filings: "Filings reviewed",
    list_documents: "Documents listed",
    read_workspace_file: "Document read", write_file: "Document saved", skill: "Skill loaded",
  };
  return labels[name] || "Done";
}

function toolContext(name: string, args: string | undefined): string | null {
  if (!args) return null;
  try {
    const p = JSON.parse(args);
    switch (name) {
      case "navigate": return p.destination || null;
      case "create_filing": return p.title ? `${p.title}${p.type ? ` · ${p.type}` : ""}` : null;
      case "update_filing": return p.filing || null;
      case "add_checklist_item": return p.filing || null;
      case "read_workspace_file": return p.path || "uploaded document";
      case "write_file": return p.path || null;
      case "skill": return p.name || null;
      default: return null;
    }
  } catch { return null; }
}

function StepIcon({ running, outcome, skill }: { running: boolean; outcome: ToolOutcome | undefined; skill: boolean }) {
  if (running) return <span className="step-ic step-ic-running"><Activity size={12} className="animate-pulse" /></span>;
  if (skill) return <span className="step-ic step-ic-skill"><Sparkles size={11} /></span>;
  if (outcome === "noop") return <span className="step-ic step-ic-noop"><HelpCircle size={12} /></span>;
  if (outcome === "error") return <span className="step-ic step-ic-error"><AlertCircle size={12} /></span>;
  if (outcome === undefined) return <span className="step-ic step-ic-neutral"><Circle size={11} /></span>;
  return <span className="step-ic step-ic-ok"><CheckCircle2 size={12} /></span>;
}

function Step({ part, onPick }: { part: MessagePart & { type: "tool_call" }; onPick?: (text: string) => void }) {
  const running = part.status === "running";
  const isSkill = part.tool === "skill";
  const label = running ? runningLabel(part.tool) : doneLabel(part.tool, part.outcome);
  const ctx = toolContext(part.tool, part.args);
  const candidates = !running ? part.candidates ?? [] : [];
  return (
    <div className="step-block">
      <div className={`step-row ${isSkill ? "step-row-skill" : ""}`}>
        <StepIcon running={running} outcome={part.outcome} skill={isSkill} />
        <span className="step-label">{label}</span>
        {ctx && <span className="step-ctx" title={ctx}>{ctx}</span>}
      </div>
      {candidates.length > 0 && (
        <div className="step-candidates">
          {candidates.map((c) => (
            <button key={c} type="button" className="step-candidate" disabled={!onPick}
              onClick={() => onPick?.(`Take me to ${c}`)} data-testid={`nav-candidate-${c.replace(/\s+/g, "-")}`}>
              {c}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ToolTrace({ parts, onPick }: { parts: (MessagePart & { type: "tool_call" })[]; isStreaming?: boolean; onPick?: (text: string) => void }) {
  if (parts.length === 0) return null;
  return (
    <div className="step-trace" data-testid="tool-trace">
      {parts.map((p) => <Step key={p.toolCallId} part={p} onPick={onPick} />)}
    </div>
  );
}
