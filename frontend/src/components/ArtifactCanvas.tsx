"use client";

import { useEffect, useMemo, useState } from "react";
import { FileText, Sparkles, Pencil, Check, X } from "lucide-react";
import GlassPanel from "./ui/GlassPanel";
import MarkdownRenderer from "./MarkdownRenderer";
import { getFileContent, saveFileContent } from "@/lib/api";
import { useSession } from "./SessionProvider";

const EDITABLE = /\.(md|txt|csv)$/i;

// The artifact canvas: the assistant's work output gets real room here — drafts,
// document analyses, and other generated artifacts. Renders from server state (the
// generated files in the workspace), not chat echo, so what you see is verifiable.
export default function ArtifactCanvas() {
  const { state } = useSession();
  const artifacts = useMemo(
    () => state.files.filter((f) => f.origin === "generated").sort((a, b) => (a.modified_at < b.modified_at ? 1 : -1)),
    [state.files],
  );

  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Auto-select the newest artifact as they appear.
  useEffect(() => {
    if (artifacts.length === 0) { setSelected(null); return; }
    if (!selected || !artifacts.some((a) => a.filename === selected)) setSelected(artifacts[0].filename);
  }, [artifacts, selected]);

  useEffect(() => {
    if (!selected || !state.sessionId) { setContent(""); return; }
    let cancelled = false;
    setLoading(true); setError(null); setEditing(false);
    getFileContent(state.sessionId, selected)
      .then((r) => { if (!cancelled) setContent(r.content); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load artifact."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selected, state.sessionId]);

  const editable = !!selected && EDITABLE.test(selected) && !loading && !error;
  const startEdit = () => { setDraft(content); setSaveError(null); setEditing(true); };
  const cancelEdit = () => { setEditing(false); setSaveError(null); };
  const saveEdit = async () => {
    if (!selected || !state.sessionId) return;
    setSaving(true); setSaveError(null);
    try {
      await saveFileContent(state.sessionId, selected, draft);
      setContent(draft);
      setEditing(false);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full flex-col gap-3 min-w-0" data-testid="artifact-canvas">
      <header className="h-14 flex items-center justify-between px-5 bg-surface-1/70 backdrop-blur-2xl rounded-2xl border border-border-subtle shrink-0">
        <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-text-muted">Artifacts</span>
        <div className="flex items-center gap-2">
          {editing ? (
            <>
              <button type="button" data-testid="artifact-save" onClick={saveEdit} disabled={saving}
                className="interactive-control inline-flex items-center gap-1.5 rounded-lg bg-brand-primary px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-white disabled:opacity-50">
                <Check size={13} strokeWidth={2.5} />{saving ? "Saving…" : "Save"}
              </button>
              <button type="button" data-testid="artifact-cancel" onClick={cancelEdit} disabled={saving}
                className="interactive-control inline-flex items-center gap-1.5 rounded-lg bg-surface-2 border border-border-subtle px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-text-secondary">
                <X size={13} strokeWidth={2.5} />Cancel
              </button>
            </>
          ) : (
            <>
              {editable && (
                <button type="button" data-testid="artifact-edit" onClick={startEdit}
                  className="interactive-control inline-flex items-center gap-1.5 rounded-lg bg-surface-2 border border-border-subtle px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-text-secondary hover:text-text-primary hover:border-brand-primary">
                  <Pencil size={13} strokeWidth={2.5} />Edit
                </button>
              )}
              {artifacts.length > 0 && (
                <span className="text-[11px] font-semibold text-text-muted">{artifacts.length} artifact{artifacts.length === 1 ? "" : "s"}</span>
              )}
            </>
          )}
        </div>
      </header>

      <GlassPanel variant="light" className="flex-1 flex min-h-0 overflow-hidden">
        {artifacts.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-10 text-center">
            <div className="p-3 rounded-2xl bg-surface-2 text-text-muted"><Sparkles size={22} /></div>
            <p className="text-sm font-semibold text-text-secondary">No artifacts yet</p>
            <p className="text-xs text-text-muted max-w-xs leading-relaxed">
              When the assistant drafts a deliverable or analyzes a document, it appears here —
              editable and traceable to its source.
            </p>
          </div>
        ) : (
          <div className="flex flex-1 min-h-0">
            {artifacts.length > 1 && (
            <nav className="w-52 shrink-0 border-r border-border-subtle overflow-y-auto p-2">
              {artifacts.map((a) => (
                <button
                  key={a.filename}
                  type="button"
                  data-testid={`artifact-${a.filename}`}
                  onClick={() => setSelected(a.filename)}
                  className={`w-full text-left rounded-xl px-3 py-2.5 mb-1 transition-all flex items-start gap-2 ${selected === a.filename ? "bg-surface-2 border border-brand-primary/40" : "hover:bg-surface-2 border border-transparent"}`}
                >
                  <FileText size={14} className="mt-0.5 shrink-0 text-text-muted" />
                  <span className="text-[12px] font-medium text-text-secondary break-all leading-snug">{a.filename}</span>
                </button>
              ))}
            </nav>
            )}
            <div className="flex-1 min-w-0 overflow-y-auto p-6" data-testid="artifact-viewer">
              {loading ? (
                <p className="text-sm text-text-muted">Loading…</p>
              ) : error ? (
                <p className="text-sm text-brand-warning">{error}</p>
              ) : editing ? (
                <div className="flex h-full flex-col gap-2">
                  {saveError && <p className="text-xs text-brand-warning">{saveError}</p>}
                  <textarea
                    data-testid="artifact-editor"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    spellCheck={false}
                    className="flex-1 min-h-[60vh] w-full resize-none rounded-xl border border-border-subtle bg-surface-2/50 p-4 font-mono text-[13px] leading-relaxed text-text-primary outline-none focus:border-brand-primary"
                  />
                </div>
              ) : (
                <>
                  <div data-testid="artifact-provenance" className="mb-4 flex items-center gap-2 rounded-lg border border-brand-warning/40 bg-brand-warning/10 px-3 py-2 text-[11px] font-semibold text-brand-warning">
                    <Sparkles size={13} /> AI-generated draft · unreviewed — verify before use
                  </div>
                  <MarkdownRenderer content={content} />
                </>
              )}
            </div>
          </div>
        )}
      </GlassPanel>
    </div>
  );
}
