"use client";

import { useEffect, useRef, useState } from "react";
import {
  FileText, CheckCircle2, Circle, Clock, ArrowLeft, Building2, AlertTriangle,
} from "lucide-react";
import type { AppFile, AppState, TWFiling } from "@/lib/types";
import { getFileContent } from "@/lib/api";
import { friendlyError } from "@/lib/utils";
import MarkdownRenderer from "../MarkdownRenderer";
import CsvTable from "../CsvTable";
import WorkbenchNav from "./WorkbenchNav";

interface WorkbenchAppProps {
  appState: AppState | null;
  loading: boolean;
  viewRoute: string;
  onNavigate: (route: string) => void;
  sessionId: string | null;
  uploadedFiles: AppFile[];
  generatedFiles: AppFile[];
  newRecordIds: string[];
  agentWorking: boolean;
}

const DONE_STATUSES = new Set(["filed", "complete", "completed", "closed", "done"]);

// A filing is overdue iff its due date is past today and it isn't filed/done — computed
// client-side from the real date (mirrors taxdb.is_overdue) so the pane never shows a stale flag.
function isOverdue(f: TWFiling, today: string): boolean {
  if (DONE_STATUSES.has((f.status || "").toLowerCase())) return false;
  const d = (f.dueDate || "").slice(0, 10);
  return !!d && d < today;
}

function StatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  let cls = "tw-badge-gray";
  let Icon = Circle;
  if (s.includes("progress")) { cls = "tw-badge-steel"; Icon = Clock; }
  else if (DONE_STATUSES.has(s) || s.includes("filed")) { cls = "tw-badge-green"; Icon = CheckCircle2; }
  else if (s.includes("review")) { cls = "tw-badge-gold"; Icon = Clock; }
  return <span className={`tw-badge ${cls}`}><Icon size={11} strokeWidth={2.5} />{status}</span>;
}

function TypeBadge({ type }: { type: string }) {
  return <span className="tw-type tw-type-general">{type}</span>;
}

function OverdueBadge() {
  return <span className="tw-badge tw-badge-gold"><AlertTriangle size={11} strokeWidth={2.5} />Overdue</span>;
}

export default function WorkbenchApp({
  appState, loading, viewRoute, onNavigate, sessionId, uploadedFiles, generatedFiles, newRecordIds, agentWorking,
}: WorkbenchAppProps) {
  const [doc, setDoc] = useState<{ filename: string; content: string; mime?: string; loading: boolean; error: string | null } | null>(null);
  const [pulse, setPulse] = useState(false);
  const prevRoute = useRef(viewRoute);

  // Briefly pulse the app header when the view changes (e.g. agent navigation) so
  // it's obvious the pane moved.
  useEffect(() => {
    if (prevRoute.current !== viewRoute) {
      prevRoute.current = viewRoute;
      setPulse(true);
      const id = setTimeout(() => setPulse(false), 1100);
      return () => clearTimeout(id);
    }
  }, [viewRoute]);

  // Leaving the Documents view closes any open document so returning shows the
  // list, not a stale previously-opened doc.
  useEffect(() => {
    if (viewRoute !== "/documents") setDoc(null);
  }, [viewRoute]);

  const openDoc = async (filename: string) => {
    if (!sessionId) return;
    setDoc({ filename, content: "", mime: undefined, loading: true, error: null });
    try {
      const data = await getFileContent(sessionId, filename);
      setDoc({ filename, content: data.content, mime: data.mime_type, loading: false, error: null });
    } catch (err) {
      setDoc({ filename, content: "", mime: undefined, loading: false, error: friendlyError(err, "Could not open document.") });
    }
  };

  return (
    <div className="tw-app" data-testid="workbench-app">
      {/* App header */}
      <div className={`tw-appbar ${pulse ? "tw-appbar-pulse" : ""}`}>
        <div className="tw-appbar-brand">
          <div className="tw-logo"><Building2 size={16} strokeWidth={2.5} /></div>
          <div className="flex flex-col leading-tight">
            <span className="tw-appbar-title">Tax Workbench</span>
            <span className="tw-appbar-sub">{agentWorking ? "Assistant working…" : "Ready"}</span>
          </div>
        </div>
        <Breadcrumb appState={appState} viewRoute={viewRoute} />
      </div>

      <div className="tw-body">
        <WorkbenchNav appState={appState} viewRoute={viewRoute} onNavigate={onNavigate} />

        {/* Content */}
        <div className="tw-content" data-testid="workbench-content">
          {loading && !appState ? (
            <div className="tw-empty">Loading workspace…</div>
          ) : doc && viewRoute === "/documents" ? (
            <DocViewer doc={doc} onBack={() => setDoc(null)} />
          ) : (
            <RouteContent
              appState={appState}
              viewRoute={viewRoute}
              onNavigate={onNavigate}
              uploadedFiles={uploadedFiles}
              generatedFiles={generatedFiles}
              newRecordIds={newRecordIds}
              onOpenDoc={openDoc}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function Breadcrumb({ appState, viewRoute }: { appState: AppState | null; viewRoute: string }) {
  if (!appState) return null;
  let trail = "Dashboard";
  if (viewRoute.startsWith("/filings/")) {
    const f = appState.filings.find((x) => x.id === viewRoute.split("/").pop());
    trail = `Filings  ›  ${f?.title ?? ""}`;
  } else if (viewRoute === "/filings") trail = "Filings";
  else if (viewRoute === "/documents") trail = "Documents";
  return <div className="tw-breadcrumb" data-testid="breadcrumb">{trail}</div>;
}

function RouteContent({ appState, viewRoute, onNavigate, uploadedFiles, generatedFiles, newRecordIds, onOpenDoc }: {
  appState: AppState | null; viewRoute: string; onNavigate: (r: string) => void;
  uploadedFiles: AppFile[]; generatedFiles: AppFile[]; newRecordIds: string[]; onOpenDoc: (f: string) => void;
}) {
  if (!appState) return <div className="tw-empty">No data.</div>;
  const isNew = (id: string) => newRecordIds.includes(id);
  const today = new Date().toISOString().slice(0, 10);

  // Filing detail
  if (viewRoute.startsWith("/filings/")) {
    const f = appState.filings.find((x) => x.id === viewRoute.split("/").pop());
    if (!f) return <div className="tw-empty">Filing not found.</div>;
    const checklist = f.checklist ?? [];
    const done = checklist.filter((c) => c.done).length;
    const overdue = isOverdue(f, today);
    return (
      <div className="tw-screen" data-testid="filing-detail">
        <button type="button" className="tw-back" onClick={() => onNavigate("/filings")}><ArrowLeft size={14} /> All filings</button>
        <h1 className="tw-h1">{f.title}</h1>
        <div className="flex flex-wrap items-center gap-2 mt-1">
          <TypeBadge type={f.type || "Filing"} />
          <StatusBadge status={f.status} />
          {overdue && <OverdueBadge />}
        </div>

        <div className="tw-stats" style={{ marginTop: 18 }}>
          <Stat label="Due" value={f.dueDate || "—"} />
          <Stat label="Assignee" value={f.assignee || "Unassigned"} />
          <Stat label="Checklist" value={`${done}/${checklist.length}`} />
        </div>

        <section className="tw-section">
          <h2 className="tw-h2">Checklist <span className="tw-count">{checklist.length}</span></h2>
          {checklist.length === 0 ? (
            <div className="tw-empty-card"><Circle size={16} /> No checklist items yet. Ask the assistant to add a step.</div>
          ) : (
            <div className="tw-doclist" data-testid="filing-checklist">
              {checklist.map((c, i) => (
                <div key={i} className="tw-docitem" data-testid={`checklist-item-${i}`} style={{ cursor: "default" }}>
                  {c.done ? <CheckCircle2 size={15} className="text-green-500" /> : <Circle size={15} />}
                  <span className={c.done ? "line-through opacity-60" : ""}>{c.text}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    );
  }

  // Filings list
  if (viewRoute === "/filings") {
    const filings = appState.filings;
    const overdueCount = filings.filter((f) => isOverdue(f, today)).length;
    return (
      <div className="tw-screen" data-testid="filings-screen">
        <h1 className="tw-h1">Filings</h1>
        <p className="tw-subtle">Returns, estimated payments, extensions, and provisions.</p>
        <div className="tw-stats">
          <Stat label="Filings" value={filings.length} />
          <Stat label="Open" value={filings.filter((f) => !DONE_STATUSES.has((f.status || "").toLowerCase())).length} />
          <Stat label="Overdue" value={overdueCount} />
        </div>
        <section className="tw-section">
          {filings.length === 0 ? <div className="tw-empty-sm">No filings yet. Ask the assistant to create one.</div> : (
            <table className="tw-table" data-testid="filings-table">
              <thead><tr><th>Filing</th><th>Type</th><th>Status</th><th>Due</th><th>Assignee</th><th>Checklist</th></tr></thead>
              <tbody>
                {filings.map((f) => {
                  const checklist = f.checklist ?? [];
                  const done = checklist.filter((c) => c.done).length;
                  const overdue = isOverdue(f, today);
                  return (
                    <tr key={f.id} data-testid={`filing-row-${f.id}`} className={`tw-rowlink ${isNew(f.id) ? "tw-row-new" : ""}`} onClick={() => onNavigate(`/filings/${f.id}`)}>
                      <td className="tw-td-title">{f.title}{isNew(f.id) && <span className="tw-new">New</span>}</td>
                      <td><TypeBadge type={f.type || "Filing"} /></td>
                      <td><div className="flex items-center gap-1.5">{overdue && <OverdueBadge />}<StatusBadge status={f.status} /></div></td>
                      <td className="tw-td-mono">{f.dueDate || "—"}</td>
                      <td>{f.assignee || "Unassigned"}</td>
                      <td className="tw-td-mono">{done}/{checklist.length}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      </div>
    );
  }

  if (viewRoute === "/documents") {
    return (
      <div className="tw-screen" data-testid="documents-screen">
        <h1 className="tw-h1">Documents</h1>
        <DocGroup label="Uploaded" files={uploadedFiles} onOpen={onOpenDoc} emptyLabel="No uploaded documents. Upload one from the chat." testid="uploaded-group" />
        <DocGroup label="Generated by assistant" files={generatedFiles} onOpen={onOpenDoc} emptyLabel="No generated documents yet. Ask the assistant to draft one." testid="generated-group" />
      </div>
    );
  }

  // Dashboard (default)
  const filings = appState.filings;
  const openFilings = filings.filter((f) => !DONE_STATUSES.has((f.status || "").toLowerCase()));
  const overdue = filings.filter((f) => isOverdue(f, today));
  const upcoming = openFilings
    .filter((f) => f.dueDate)
    .sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : 1))
    .slice(0, 6);
  return (
    <div className="tw-screen" data-testid="dashboard-screen">
      <h1 className="tw-h1">Dashboard</h1>
      <p className="tw-subtle">A snapshot of your filings.</p>
      <div className="tw-stats">
        <Stat label="Filings" value={filings.length} />
        <Stat label="Open" value={openFilings.length} />
        <Stat label="Overdue" value={overdue.length} />
      </div>

      {overdue.length > 0 && (
        <section className="tw-section">
          <h2 className="tw-h2">Overdue <span className="tw-count">{overdue.length}</span></h2>
          <table className="tw-table" data-testid="overdue-table">
            <thead><tr><th>Filing</th><th>Type</th><th>Status</th><th>Due</th></tr></thead>
            <tbody>
              {overdue.map((f) => (
                <tr key={f.id} className="tw-rowlink" data-testid={`overdue-row-${f.id}`} onClick={() => onNavigate(`/filings/${f.id}`)}>
                  <td className="tw-td-title">{f.title}</td>
                  <td><TypeBadge type={f.type || "Filing"} /></td>
                  <td><StatusBadge status={f.status} /></td>
                  <td className="tw-td-mono">{f.dueDate}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="tw-section">
        <h2 className="tw-h2">Upcoming deadlines</h2>
        {upcoming.length === 0 ? <div className="tw-empty-sm">No open deadlines.</div> : (
          <table className="tw-table" data-testid="deadlines-table">
            <thead><tr><th>Filing</th><th>Type</th><th>Status</th><th>Due</th></tr></thead>
            <tbody>
              {upcoming.map((f) => (
                <tr key={f.id} className="tw-rowlink" onClick={() => onNavigate(`/filings/${f.id}`)}>
                  <td className="tw-td-title">{f.title}</td>
                  <td><TypeBadge type={f.type || "Filing"} /></td>
                  <td><StatusBadge status={f.status} /></td>
                  <td className="tw-td-mono">{f.dueDate}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return <div className="tw-stat"><div className="tw-stat-value">{value}</div><div className="tw-stat-label">{label}</div></div>;
}

function DocGroup({ label, files, onOpen, emptyLabel, testid }: { label: string; files: AppFile[]; onOpen: (f: string) => void; emptyLabel: string; testid: string }) {
  return (
    <section className="tw-section" data-testid={testid}>
      <h2 className="tw-h2">{label} <span className="tw-count">{files.length}</span></h2>
      {files.length === 0 ? <div className="tw-empty-sm">{emptyLabel}</div> : (
        <div className="tw-doclist">
          {files.map((f) => (
            <button key={f.filename} type="button" className="tw-docitem" onClick={() => onOpen(f.filename)} data-testid={`doc-${f.filename}`}>
              <FileText size={15} />
              <span className="truncate">{f.filename}</span>
              {f.status === "pending" && <span className="tw-doc-pending">processing…</span>}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function DocViewer({ doc, onBack }: { doc: { filename: string; content: string; mime?: string; loading: boolean; error: string | null }; onBack: () => void }) {
  const isCsv = doc.filename.toLowerCase().endsWith(".csv");
  return (
    <div className="tw-screen" data-testid="doc-viewer">
      <button type="button" className="tw-back" onClick={onBack}><ArrowLeft size={14} /> All documents</button>
      <h1 className="tw-h1">{doc.filename}</h1>
      {doc.loading ? <div className="tw-empty-sm">Loading…</div> :
        doc.error ? <div className="tw-empty-sm">{doc.error}</div> :
        isCsv ? <CsvTable content={doc.content} /> :
        <div className="tw-doc"><MarkdownRenderer content={doc.content} /></div>}
    </div>
  );
}
