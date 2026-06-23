// Flow end-to-end Playwright driver — drives the REAL frontend as a user and
// captures screenshots under screenshots/flow/. Also dumps /app/state at key
// points so "the agent said it did X" is proven against "X exists in app state"
// (the anti-hallucination same-fact check). Run: node scripts/flow_e2e.mjs
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

const APP = process.env.APP_URL || "http://localhost:3000";
const API = process.env.API_URL || "http://localhost:8000";
const OUT = process.env.OUT || "screenshots/flow";
mkdirSync(OUT, { recursive: true });

const results = [];
const check = (label, cond, detail = "") => {
  results.push({ label, ok: !!cond, detail });
  console.log(cond ? "  ✅" : "  ❌", label, detail ? `— ${detail}` : "");
};
const shot = async (page, name) => { await page.screenshot({ path: `${OUT}/${name}.png` }); console.log("  📸", name); };

async function send(page, text) {
  console.log("→", text.slice(0, 80).replace(/\n/g, " "));
  await page.fill("[data-testid=chat-input]", text);
  await page.click("[data-testid=send-button]");
  try { await page.waitForSelector("[data-testid=stop-button]", { timeout: 10000 }); } catch {}
  await page.waitForSelector("[data-testid=send-button]", { timeout: 180000 });
  await page.waitForTimeout(1800); // allow /app/state refetch to render
}
const lastAssistant = async (page) =>
  (await page.locator(".message-row-assistant, [data-testid=assistant-message]").last().innerText().catch(() => "")) || "";

async function getSid(page) { return await page.evaluate(() => sessionStorage.getItem("flow_session_id")); }
async function dumpState(sid, tag) {
  const res = await fetch(`${API}/sessions/${sid}/app/state`);
  const s = await res.json();
  writeFileSync(`${OUT}/state-${tag}.json`, JSON.stringify(s, null, 2));
  return s;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1480, height: 920 } });
  page.on("pageerror", (e) => console.log("  ‼️ pageerror:", e.message));

  // [A/B] Landing → Home renders from seed
  console.log("\n[A] Landing / Home");
  await page.goto(APP, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-testid=workbench-app]", { timeout: 40000 });
  await page.waitForSelector("[data-testid=home-screen]", { timeout: 40000 });
  await shot(page, "01-home");
  const sid = await getSid(page);
  const seed = await dumpState(sid, "seed");
  check("Home screen renders", await page.locator("[data-testid=home-screen]").isVisible());
  check("seed has tasks+events", (seed.tasks?.length || 0) >= 1 && (seed.events?.length || 0) >= 1, `tasks=${seed.tasks?.length} events=${seed.events?.length}`);

  // [B] Client-side nav to each surface (instant, no agent)
  console.log("\n[B] Client nav across surfaces");
  for (const [route, screen, n] of [["/todo","todo-screen","02-todo"],["/calendar","calendar-screen","03-calendar"],["/documents","documents-screen","04-documents"],["/home","home-screen","05-home-again"]]) {
    await page.click(`[data-testid=nav-${route.replace(/\//g,"-")}]`);
    const ok = await page.waitForSelector(`[data-testid=${screen}]`, { timeout: 10000 }).then(()=>true).catch(()=>false);
    await shot(page, n);
    check(`client-nav ${route} → ${screen}`, ok);
  }

  // [C] Agent navigation (one navigate call)
  console.log("\n[C] Agent navigation");
  await page.click(`[data-testid=nav--home]`);
  await send(page, "take me to my calendar");
  const calVisible = await page.locator("[data-testid=calendar-screen]").isVisible().catch(()=>false);
  await shot(page, "06-agent-nav-calendar");
  check("agent navigated to calendar", calVisible);

  // [D] Task CRUD — create / update / subtask, with state dumps
  console.log("\n[D] Task CRUD");
  await send(page, "Add a high-priority task called 'Submit conference proposal' due 2026-06-27 in the Work group.");
  await page.click(`[data-testid=nav--todo]`); await page.waitForTimeout(800);
  await shot(page, "07-task-created");
  let st = await dumpState(sid, "after-create-task");
  const created = (st.tasks||[]).find(t => /conference proposal/i.test(t.title));
  check("create_task: row in app state", !!created, created ? `${created.title} / ${created.status} / ${created.priority} / due ${created.dueDate}` : "not found");
  check("create_task: rendered in To-Do", await page.getByText("Submit conference proposal").first().isVisible().catch(()=>false));
  check("create_task: priority=High & group=Work", created && created.priority === "High" && /work/i.test(created.group||""), created ? `${created.priority}/${created.group}` : "");

  await send(page, "Mark 'Submit conference proposal' as in progress.");
  st = await dumpState(sid, "after-update-task");
  const upd = (st.tasks||[]).find(t => /conference proposal/i.test(t.title));
  await page.click(`[data-testid=nav--todo]`); await page.waitForTimeout(600);
  await shot(page, "08-task-updated");
  check("update_task: status now In progress in state", upd && upd.status === "In progress", upd ? upd.status : "");

  await send(page, "Add a subtask 'draft the abstract' to 'Submit conference proposal'.");
  st = await dumpState(sid, "after-subtask");
  const subTask = (st.tasks||[]).find(t => /conference proposal/i.test(t.title));
  check("add_subtask: subtask in state", subTask && (subTask.subtasks||[]).some(s => /abstract/i.test(s.text)), JSON.stringify(subTask?.subtasks||[]));

  // [E] Event CRUD
  console.log("\n[E] Event CRUD");
  await send(page, "Schedule a meeting called 'Sync with Sam' on 2026-06-26 at 15:00.");
  st = await dumpState(sid, "after-create-event");
  const ev = (st.events||[]).find(e => /sync with sam/i.test(e.title));
  await page.click(`[data-testid=nav--calendar]`); await page.waitForTimeout(600);
  await shot(page, "09-event-created");
  check("create_event: event in state", !!ev, ev ? `${ev.title} ${ev.date} ${ev.start||""}` : "not found");

  await send(page, "Move 'Sync with Sam' to 2026-06-25.");
  st = await dumpState(sid, "after-move-event");
  const ev2 = (st.events||[]).find(e => /sync with sam/i.test(e.title));
  await page.click(`[data-testid=nav--calendar]`); await page.waitForTimeout(600);
  await shot(page, "10-event-moved");
  check("update_event: date moved to 2026-06-25", ev2 && ev2.date === "2026-06-25", ev2 ? ev2.date : "");

  // [F] Document ops — draft then edit (artifact canvas lives in the AI Workbench, not host routes)
  console.log("\n[F] Document ops");
  await send(page, "Draft a short project kickoff document with a title, goals, and next steps, and save it as kickoff.md.");
  await page.waitForTimeout(1000);
  // open the generated artifact in the workspace canvas via the dock card (or fall back to AI Workbench nav)
  const dockCard = page.locator("[data-testid=dock-artifact-card]");
  if (await dockCard.count()) { await dockCard.first().click(); } else { await page.click("[data-testid=nav-assistant]"); }
  await page.waitForSelector("[data-testid=artifact-viewer]", { timeout: 15000 }).catch(()=>{});
  await page.waitForTimeout(900);
  await shot(page, "11-doc-drafted");
  const canvasText = await page.locator("[data-testid=artifact-viewer]").first().innerText().catch(()=>"");
  check("draft: artifact canvas shows kickoff content", /goals|next steps|kickoff/i.test(canvasText), canvasText.slice(0,90).replace(/\n/g," "));
  const files = ((await fetch(`${API}/sessions/${sid}/files`).then(r=>r.json()).catch(()=>({}))).files)||[];
  check("draft: kickoff.md created in workspace (exact)", files.some(f => (f.filename||"").toLowerCase()==="kickoff.md"), files.map(f=>f.filename).join(", "));

  const fetchDoc = async () => (await fetch(`${API}/sessions/${sid}/files/content?filename=kickoff.md`).then(r=>r.json()).catch(()=>({}))).content || "";
  const before = await fetchDoc();
  await send(page, "Tighten the introduction of kickoff.md to a single punchy sentence.");
  await page.waitForTimeout(1000);
  await shot(page, "12-doc-edited");
  const after = await fetchDoc();
  check("edit: kickoff.md content changed after edit", before && after && before !== after, `len ${before.length}→${after.length}`);

  // [I] Fail-loud: unknown destination
  console.log("\n[I] Fail-loud unknown nav");
  const beforeRoute = (await dumpState(sid, "before-failnav")).currentRoute;
  await send(page, "take me to the crypto mining dashboard");
  await shot(page, "13-fail-loud-nav");
  const flText = await lastAssistant(page);
  const afterRoute = (await dumpState(sid, "after-failnav")).currentRoute;
  check("unknown destination fails loud (no false nav)", /not exist|not found|couldn'?t find|don'?t have|no .*(page|destination|dashboard)/i.test(flText), flText.replace(/\n/g," ").slice(0,110));
  check("route unchanged after failed nav", beforeRoute === afterRoute, `${beforeRoute} == ${afterRoute}`);

  // [H] Persistence after reload — full navigation back to the host app root (the doc step
  // left us on /assistant, which has no workbench-app); this is a fresh load that restores
  // the session purely from server-side /app/state.
  console.log("\n[H] Persistence after reload");
  await page.goto(APP, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-testid=workbench-app]", { timeout: 40000 });
  await page.click(`[data-testid=nav--todo]`); await page.waitForTimeout(1200);
  await shot(page, "14-persistence-after-reload");
  check("created task persists after reload", await page.getByText("Submit conference proposal").first().isVisible().catch(()=>false));

  await browser.close();
  console.log("\n===== SUMMARY =====");
  const passed = results.filter(r=>r.ok).length;
  for (const r of results) console.log(`${r.ok?"PASS":"FAIL"}  ${r.label}${r.detail?`  (${r.detail})`:""}`);
  console.log(`\n${passed}/${results.length} checks passed`);
  writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
  process.exit(passed === results.length ? 0 : 2);
}
main().catch((e)=>{ console.error("FATAL", e); process.exit(1); });
