// Reminder management lifecycle via real chat: create (weekly) → list → delete,
// verifying the Reminders screen + /app/state at each step. Run after a clean owner doc.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const APP = "http://localhost:3000", API = "http://localhost:8000";
const OUT = "screenshots/flow-reminders-lifecycle"; mkdirSync(OUT, { recursive: true });
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
await page.goto(APP, { waitUntil: "domcontentloaded" });
await page.waitForSelector("[data-testid=workbench-app]", { timeout: 40000 });
await page.waitForFunction(() => !!sessionStorage.getItem("flow_session_id"), { timeout: 20000 });
const sid = await sidOf(page);
console.log("session:", sid);

console.log("\n[1] Create a WEEKLY reminder via chat");
await send(page, "Every Monday and Friday at 7:30am, email me a list of my open tasks.");
let st = await state(sid);
let s = (st.schedules || [])[0];
check("weekly schedule created", !!s && s.frequency === "weekly", s ? `${s.frequency} ${s.time} days=${JSON.stringify(s.daysOfWeek)}` : "none");
check("days are Mon+Fri (0,4)", s && JSON.stringify((s.daysOfWeek||[]).slice().sort()) === "[0,4]", JSON.stringify(s?.daysOfWeek));
await nav(page, "/reminders", "reminders-screen");
await shot(page, "01-weekly-created");
check("weekly cadence rendered", /weekly on .*mon.*fri.*07:30/i.test(await page.locator("[data-testid=reminders-table]").innerText()));

console.log("\n[2] List reminders via chat");
await nav(page, "/home", "home-screen");
await send(page, "What reminders do I have set up?");
await shot(page, "02-list-response");
const listed = await page.getByText(/open tasks|weekly|monday|friday/i).first().isVisible().catch(() => false);
check("agent lists the reminder", listed);

console.log("\n[3] Delete the reminder via chat");
await send(page, "Delete that reminder.");
st = await state(sid);
check("schedule removed from Cosmos", (st.schedules || []).length === 0, `schedules=${(st.schedules||[]).length}`);
await nav(page, "/reminders", "reminders-screen");
await shot(page, "03-after-delete");
check("Reminders screen empty again", /no reminders yet/i.test(await page.locator("[data-testid=reminders-screen]").innerText()));

await browser.close();
const passed = results.filter(r => r.c).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 2);
