// Verify the Flow -> Personal Assistant rename renders in the real UI and the app still works.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
const OUT = "screenshots/rename"; mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ headless: true });
const p = await b.newPage({ viewport: { width: 1480, height: 900 } });
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
let fails = 0; const ck = (l, ok, d = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${l}${d ? ` — ${String(d).slice(0,120)}` : ""}`); if (!ok) fails++; };

await p.goto("http://localhost:3000", { waitUntil: "networkidle" });
await p.waitForSelector("[data-testid=workbench-app]", { timeout: 30000 });
await p.waitForTimeout(1200);
await p.screenshot({ path: `${OUT}/01-home.png` });

const tabTitle = await p.title();
ck("browser tab title is 'Personal Assistant'", /Personal Assistant/.test(tabTitle), tabTitle);
const appbar = await p.locator(".tw-appbar-title").first().innerText().catch(() => "");
ck("app-bar shows 'Personal Assistant'", /Personal Assistant/.test(appbar), appbar);
const bodyText = await p.locator("[data-testid=workbench-app]").innerText().catch(() => "");
ck("no 'Flow' branding leaks in the host UI", !/\bFlow\b/.test(bodyText), (bodyText.match(/\bFlow\b.{0,20}/) || [""])[0]);

// app still works: drive one agent nav turn
await p.click("[data-testid=new-chat-button]").catch(() => {});
await p.waitForTimeout(2000);
await p.fill("[data-testid=chat-input]", "take me to my to-do list");
await p.click("[data-testid=send-button]");
try { await p.waitForSelector("[data-testid=stop-button]", { timeout: 10000 }); } catch {}
await p.waitForSelector("[data-testid=send-button]", { timeout: 120000 });
await p.waitForTimeout(1500);
await p.screenshot({ path: `${OUT}/02-after-nav.png` });
const todoVisible = await p.locator("[data-testid=todo-screen]").count();
ck("agent navigation still works (To-Do rendered)", todoVisible > 0);
const assistantText = await p.locator(".message-row-assistant").last().innerText().catch(() => "");
ck("assistant replied without a 'Flow' self-reference", !/\bFlow\b/.test(assistantText), assistantText.replace(/\n/g," ").slice(0,120));

console.log(`\n${fails === 0 ? "ALL PASSED" : fails + " FAILED"} | pageErrors=${errs.length}`);
errs.forEach((e) => console.log("  pageerror:", e));
await b.close();
process.exit(fails > 0 || errs.length > 0 ? 1 : 0);
