// Proves the Cosmos fix: app-state is now keyed by a STABLE owner id, so data
// persists across SEPARATE sessions (new session id = new tab/visit), not just an
// in-tab reload. Old behavior: a fresh session id => blank doc. New: same owner doc.
// Run: node scripts/flow_owner_persist_e2e.mjs
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

const APP = "http://localhost:3000", API = "http://localhost:8000";
const OUT = "screenshots/flow-owner"; mkdirSync(OUT, { recursive: true });
const MARK = "Persist check ALPHA";
const results = [];
const check = (l, c, d = "") => { results.push({ l, c: !!c, d }); console.log(c ? "  ✅" : "  ❌", l, d ? `— ${d}` : ""); };
const shot = (p, n) => p.screenshot({ path: `${OUT}/${n}.png` });
const sidOf = (p) => p.evaluate(() => sessionStorage.getItem("flow_session_id"));
const state = (sid) => fetch(`${API}/sessions/${sid}/app/state`).then(r => r.json());

async function send(page, text) {
  console.log("→", text.slice(0, 78));
  await page.fill("[data-testid=chat-input]", text);
  await page.click("[data-testid=send-button]");
  try { await page.waitForSelector("[data-testid=stop-button]", { timeout: 12000 }); } catch {}
  await page.waitForSelector("[data-testid=send-button]", { timeout: 180000 });
  await page.waitForTimeout(1500);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1480, height: 920 } });

console.log("\n[1] Session A — create a task");
await page.goto(APP, { waitUntil: "domcontentloaded" });
await page.waitForSelector("[data-testid=workbench-app]", { timeout: 40000 });
await page.waitForFunction(() => !!sessionStorage.getItem("flow_session_id"), { timeout: 20000 });
const sidA = await sidOf(page);
console.log("  session A:", sidA);
await send(page, `Create a high-priority task '${MARK}' due 2026-06-28 in the Work group.`);
const sA = await state(sidA);
check("task created in session A", (sA.tasks || []).some(t => t.title === MARK), `tasks=${(sA.tasks||[]).length}`);
await page.click("[data-testid=nav--todo]"); await page.waitForSelector("[data-testid=todo-screen]"); await page.waitForTimeout(600);
await shot(page, "01-sessionA-task");

console.log("\n[2] Brand-new session B (clear sessionStorage → new session id)");
await page.evaluate(() => sessionStorage.clear());
await page.goto(APP, { waitUntil: "domcontentloaded" });
await page.waitForSelector("[data-testid=workbench-app]", { timeout: 40000 });
await page.waitForFunction(() => !!sessionStorage.getItem("flow_session_id"), { timeout: 20000 });
const sidB = await sidOf(page);
console.log("  session B:", sidB);
check("session B is a DIFFERENT session id", sidB && sidB !== sidA, `A=${sidA} B=${sidB}`);

const sB = await state(sidB);
check("session B sees the SAME task (persisted by owner key)", (sB.tasks || []).some(t => t.title === MARK), `tasks=${(sB.tasks||[]).length}`);
await page.click("[data-testid=nav--todo]"); await page.waitForSelector("[data-testid=todo-screen]"); await page.waitForTimeout(600);
await shot(page, "02-sessionB-persisted");
check("task RENDERS in new session's To-Do", await page.getByText(MARK).first().isVisible().catch(() => false));

await browser.close();
writeFileSync(`${OUT}/sids.txt`, `A=${sidA}\nB=${sidB}\n`);
const passed = results.filter(r => r.c).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 2);
