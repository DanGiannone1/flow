// Deep Agents POC — drives the real Personal Assistant frontend as a user against the
// AGENT_BACKEND=deepagents session container, screenshots each journey, and
// reconciles the rendered UI against /app/state. Run: node scripts/deepagents_poc.mjs
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

const API = "http://localhost:8000";
const OUT = "screenshots/deepagents-poc";
mkdirSync(OUT, { recursive: true });

const b = await chromium.launch({ headless: true });
const p = await b.newPage({ viewport: { width: 1480, height: 900 } });
const errs = [];
p.on("pageerror", (e) => errs.push(e.message));

let n = 0;
const shot = async (name) => p.screenshot({ path: `${OUT}/${String(++n).padStart(2, "0")}-${name}.png`, fullPage: false });
let fails = 0;
const ck = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${String(detail).replace(/\n/g, " ").slice(0, 180)}` : ""}`);
  if (!ok) fails++;
};
const lastAssistant = async () =>
  (await p.locator(".message-row-assistant").last().innerText().catch(() => "")) || "";
const traceText = async () =>
  (await p.locator("[data-testid=tool-trace]").last().innerText().catch(() => "")) || "";

async function send(text) {
  await p.fill("[data-testid=chat-input]", text);
  await p.click("[data-testid=send-button]");
  try { await p.waitForSelector("[data-testid=stop-button]", { timeout: 10000 }); } catch {}
  await p.waitForSelector("[data-testid=send-button]", { timeout: 180000 });
  await p.waitForTimeout(1500);
}

let sessionId = null;
async function readSessionId() {
  const all = await p.evaluate(() => Object.fromEntries(Object.entries(sessionStorage)));
  for (const v of Object.values(all)) {
    if (typeof v === "string" && /^[0-9a-f]{16}$/.test(v)) return v;
  }
  return null;
}
async function appState() {
  if (!sessionId) return null;
  try {
    const r = await fetch(`${API}/sessions/${sessionId}/app/state`);
    if (!r.ok) return { _error: r.status };
    return await r.json();
  } catch (e) { return { _error: String(e) }; }
}
async function files() {
  if (!sessionId) return null;
  try {
    const r = await fetch(`${API}/sessions/${sessionId}/files`);
    if (!r.ok) return { _error: r.status };
    return await r.json();
  } catch (e) { return { _error: String(e) }; }
}

// ── Boot ────────────────────────────────────────────────────────────────────
await p.goto("http://localhost:3000", { waitUntil: "networkidle" });
await p.waitForSelector("[data-testid=workbench-app]", { timeout: 30000 });
// Fresh session
await p.click("[data-testid=new-chat-button]").catch(() => {});
await p.waitForTimeout(2500);
sessionId = await readSessionId();
ck("session created (16-hex id in sessionStorage)", !!sessionId, sessionId || "none");
await shot("boot-home");
const state0 = await appState();
writeFileSync(`${OUT}/state-00-initial.json`, JSON.stringify(state0, null, 2));

// ── 1. Navigation ─────────────────────────────────────────────────────────
await send("take me to my calendar");
await shot("nav-calendar");
const navState = await appState();
ck("navigate → currentRoute is /calendar", navState?.currentRoute === "/calendar", `route=${navState?.currentRoute}`);
ck("navigate used a single tool step (no planning)", !/todo list|write_todos|step 1/i.test(await traceText()), (await traceText()).slice(0, 100));

// ── 2. Task create ─────────────────────────────────────────────────────────
await send("add a high-priority task called 'Prepare Q3 report' due 2026-06-26 in the Work group");
await p.click("[data-testid=nav--todo]").catch(() => {});
await p.waitForTimeout(1200);
await shot("task-created-todo");
const s2 = await appState();
writeFileSync(`${OUT}/state-02-task-created.json`, JSON.stringify(s2, null, 2));
const task = (s2?.tasks || []).find((t) => /Prepare Q3 report/i.test(t.title));
ck("task exists in /app/state", !!task, task ? JSON.stringify({ title: task.title, priority: task.priority, group: task.group, due: task.dueDate }) : "missing");
ck("task has High priority", task?.priority === "High", task?.priority);
ck("task in Work group", task?.group === "Work", task?.group);
const todoText = await p.locator("[data-testid=todo-screen]").innerText().catch(() => "");
ck("task row rendered in To-Do", /Prepare Q3 report/i.test(todoText), todoText.replace(/\n/g, " ").slice(0, 120));

// ── 3. Task update ─────────────────────────────────────────────────────────
await send("mark the Prepare Q3 report task in progress");
await p.waitForTimeout(800);
await shot("task-updated");
const s3 = await appState();
const task3 = (s3?.tasks || []).find((t) => /Prepare Q3 report/i.test(t.title));
ck("task status updated to In progress", task3?.status === "In progress", task3?.status);

// ── 4. Event create ────────────────────────────────────────────────────────
await send("schedule a meeting tomorrow at 3pm called Design sync");
await p.click("[data-testid=nav--calendar]").catch(() => {});
await p.waitForTimeout(1200);
await shot("event-created-calendar");
const s4 = await appState();
writeFileSync(`${OUT}/state-04-event-created.json`, JSON.stringify(s4, null, 2));
const ev = (s4?.events || []).find((e) => /Design sync/i.test(e.title));
ck("event exists in /app/state", !!ev, ev ? JSON.stringify({ title: ev.title, date: ev.date, start: ev.start }) : "missing");
ck("event start time is 15:00", ev?.start === "15:00", ev?.start);
const calText = await p.locator("[data-testid=calendar-screen]").innerText().catch(() => "");
ck("event rendered on Calendar", /Design sync/i.test(calText), calText.replace(/\n/g, " ").slice(0, 120));

// ── 5. Document draft ──────────────────────────────────────────────────────
await send("draft a short project kickoff doc and save it as kickoff.md");
await p.waitForTimeout(1000);
await shot("doc-drafted");
const fl = await files();
ck("kickoff.md written to workspace", !!(fl?.files || []).find((f) => /kickoff\.md/i.test(f.filename)), JSON.stringify((fl?.files || []).map((f) => f.filename)));
// open the artifact canvas
await p.click("[data-testid=dock-expand]").catch(() => {});
await p.waitForTimeout(1200);
const art = await p.locator("[data-testid=artifact-viewer]").innerText().catch(() => "");
await shot("doc-artifact-canvas");
ck("artifact canvas shows kickoff content", art.length > 80 && /kickoff|project|goal|overview/i.test(art), art.replace(/\n/g, " ").slice(0, 140));
await p.click("[data-testid=workspace-back]").catch(() => {});
await p.waitForTimeout(600);

// ── 6. RAG (grounded or fail-loud) ─────────────────────────────────────────
await send("what did I decide about the budget in my notes?");
await shot("rag-answer");
const a6 = await lastAssistant();
const grounded = /source|\.md|according to/i.test(a6);
const failLoud = /search.*(unavailable|not configured)|couldn't|could not|no .*(match|results)/i.test(a6);
ck("RAG answered grounded OR failed loud (no silent fabrication)", grounded || failLoud, a6.replace(/\n/g, " ").slice(0, 160));

// ── Wrap ────────────────────────────────────────────────────────────────────
writeFileSync(`${OUT}/state-final.json`, JSON.stringify(await appState(), null, 2));
console.log(`\nsession=${sessionId}`);
console.log(`${fails === 0 ? "ALL CHECKS PASSED" : fails + " CHECK(S) FAILED"} | pageErrors=${errs.length}`);
errs.forEach((e) => console.log("  pageerror:", e));
await b.close();
process.exit(fails > 0 || errs.length > 0 ? 1 : 0);
