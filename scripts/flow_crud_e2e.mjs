// Exercises the refactored (optimistic-concurrency) write tools via real chat:
// create/update/add-subtask/delete for a task, and create/update/delete for an event.
// Validates each mutation against /app/state. Run after a clean owner doc.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const APP = "http://localhost:3000", API = "http://localhost:8000";
const OUT = "screenshots/flow-crud"; mkdirSync(OUT, { recursive: true });
const results = [];
const check = (l, c, d = "") => { results.push({ l, c: !!c, d }); console.log(c ? "  ✅" : "  ❌", l, d ? `— ${d}` : ""); };
const sidOf = (p) => p.evaluate(() => sessionStorage.getItem("flow_session_id"));
const state = (sid) => fetch(`${API}/sessions/${sid}/app/state`).then(r => r.json());

async function send(page, text) {
  console.log("→", text.slice(0, 78));
  await page.fill("[data-testid=chat-input]", text);
  await page.click("[data-testid=send-button]");
  try { await page.waitForSelector("[data-testid=stop-button]", { timeout: 12000 }); } catch {}
  await page.waitForSelector("[data-testid=send-button]", { timeout: 180000 });
  await page.waitForTimeout(1200);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1480, height: 920 } });
await page.goto(APP, { waitUntil: "domcontentloaded" });
await page.waitForSelector("[data-testid=workbench-app]", { timeout: 40000 });
await page.waitForFunction(() => !!sessionStorage.getItem("flow_session_id"), { timeout: 20000 });
const sid = await sidOf(page);
console.log("session:", sid);

console.log("\n[Task CRUD]");
await send(page, "Add a task 'Draft Q3 plan' in the Work group, medium priority, due 2026-07-01.");
let st = await state(sid); let t = (st.tasks || []).find(x => /q3 plan/i.test(x.title));
check("task created", !!t, t ? `${t.title}/${t.priority}/${t.group}` : "none");

await send(page, "Mark the Q3 plan task as high priority and in progress.");
st = await state(sid); t = (st.tasks || []).find(x => /q3 plan/i.test(x.title));
check("task updated (priority+status)", t && t.priority === "High" && t.status === "In progress", t ? `${t.priority}/${t.status}` : "none");

await send(page, "Add a subtask 'Gather figures' to the Q3 plan task.");
st = await state(sid); t = (st.tasks || []).find(x => /q3 plan/i.test(x.title));
check("subtask added", t && (t.subtasks || []).some(s => /gather figures/i.test(s.text)), `subtasks=${(t?.subtasks||[]).length}`);

await send(page, "Delete the Q3 plan task.");
st = await state(sid);
check("task deleted", !(st.tasks || []).some(x => /q3 plan/i.test(x.title)), `tasks=${(st.tasks||[]).length}`);

console.log("\n[Event CRUD]");
await send(page, "Add an event 'Design review' on 2026-07-02 from 14:00 to 15:00.");
st = await state(sid); let e = (st.events || []).find(x => /design review/i.test(x.title));
check("event created", !!e, e ? `${e.title} ${e.date} ${e.start}-${e.end}` : "none");

await send(page, "Move the Design review to 2026-07-03 at 10:00.");
st = await state(sid); e = (st.events || []).find(x => /design review/i.test(x.title));
check("event updated (date+time)", e && e.date === "2026-07-03" && e.start === "10:00", e ? `${e.date} ${e.start}` : "none");

await send(page, "Delete the Design review event.");
st = await state(sid);
check("event deleted", !(st.events || []).some(x => /design review/i.test(x.title)), `events=${(st.events||[]).length}`);

await page.screenshot({ path: `${OUT}/final.png` });
await browser.close();
const passed = results.filter(r => r.c).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 2);
