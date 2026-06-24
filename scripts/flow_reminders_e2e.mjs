// Reminders e2e against the real frontend: empty Reminders screen → ask the agent to
// set up a daily email summary → it persists and renders on the Reminders screen.
// Run: node scripts/flow_reminders_e2e.mjs
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const APP = "http://localhost:3000", API = "http://localhost:8000";
const OUT = "screenshots/flow-reminders"; mkdirSync(OUT, { recursive: true });
const results = [];
const check = (l, c, d = "") => { results.push({ l, c: !!c, d }); console.log(c ? "  ✅" : "  ❌", l, d ? `— ${d}` : ""); };
const shot = (p, n) => p.screenshot({ path: `${OUT}/${n}.png` });
const sidOf = (p) => p.evaluate(() => sessionStorage.getItem("flow_session_id"));
const state = (sid) => fetch(`${API}/sessions/${sid}/app/state`).then(r => r.json());

async function send(page, text) {
  console.log("→", text.slice(0, 80));
  await page.fill("[data-testid=chat-input]", text);
  await page.click("[data-testid=send-button]");
  try { await page.waitForSelector("[data-testid=stop-button]", { timeout: 12000 }); } catch {}
  await page.waitForSelector("[data-testid=send-button]", { timeout: 180000 });
  await page.waitForTimeout(1500);
}
async function nav(page, route, screen) {
  await page.click(`[data-testid=nav-${route.replace(/\//g, "-")}]`);
  await page.waitForSelector(`[data-testid=${screen}]`, { timeout: 20000 });
  await page.waitForTimeout(600);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1480, height: 920 } });

console.log("\n[1] Reminders screen — empty");
await page.goto(APP, { waitUntil: "domcontentloaded" });
await page.waitForSelector("[data-testid=workbench-app]", { timeout: 40000 });
await page.waitForFunction(() => !!sessionStorage.getItem("flow_session_id"), { timeout: 20000 });
const sid = await sidOf(page);
console.log("  session:", sid);
await nav(page, "/reminders", "reminders-screen");
await shot(page, "01-reminders-empty");
check("Reminders empty state", /no reminders yet/i.test(await page.locator("[data-testid=reminders-screen]").innerText()));

console.log("\n[2] Ask the agent to set up a daily email summary");
await send(page, "Set up a reminder that emails me a summary of my tasks and events due in the next 3 days, every day at 8:00 AM Eastern time.");
const st = await state(sid);
const sched = (st.schedules || [])[0];
check("schedule persisted to Cosmos", !!sched, sched ? `${sched.title} | ${sched.frequency} ${sched.time} ${sched.timezone}` : "none");
check("frequency is daily", sched && sched.frequency === "daily", sched?.frequency);
check("time is 08:00", sched && sched.time === "08:00", sched?.time);
check("has a future nextRunAt", sched && !!sched.nextRunAt, sched?.nextRunAt);

console.log("\n[3] Renders on the Reminders screen");
await nav(page, "/reminders", "reminders-screen");
await page.waitForTimeout(600);
await shot(page, "02-reminders-populated");
check("reminder row rendered", await page.locator('[data-testid^="reminder-row-"]').first().isVisible().catch(() => false));
const tableText = await page.locator("[data-testid=reminders-table]").innerText().catch(() => "");
check("shows daily cadence", /daily at 08:00/i.test(tableText), tableText.split("\n").slice(0,3).join(" | "));

await browser.close();
const passed = results.filter(r => r.c).length;
console.log(`\nsession: ${sid}`);
console.log(`${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 2);
