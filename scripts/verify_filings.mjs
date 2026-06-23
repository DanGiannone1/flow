// End-to-end verification of the simplified Filings app, as a real user.
// Walks one continuous session: navigate → create filing → add checklist → draft doc → dashboard overdue.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
const OUT = "review/verify";
mkdirSync(OUT, { recursive: true });

const b = await chromium.launch({ headless: true });
const p = await b.newPage({ viewport: { width: 1480, height: 920 } });
const log = (...a) => console.log(...a);

async function ask(prompt) {
  await p.fill("[data-testid=chat-input]", prompt);
  await p.click("[data-testid=send-button]");
  try { await p.waitForSelector("[data-testid=stop-button]", { timeout: 8000 }); } catch {}
  await p.waitForSelector("[data-testid=send-button]", { timeout: 150000 });
  await p.waitForTimeout(2500);
  return await p.locator(".message-row-assistant").last().innerText().catch(() => "");
}
async function shot(name) { await p.screenshot({ path: `${OUT}/${name}.png`, fullPage: false }); log(`  shot: ${name}.png`); }

await p.goto("http://localhost:3000", { waitUntil: "networkidle" });
await p.waitForSelector("[data-testid=workbench-app]", { timeout: 30000 });
await p.waitForTimeout(1000);
await shot("00-initial-dashboard");
log("Dashboard overdue rows:", await p.locator("[data-testid^=overdue-row-]").count());

// 1) Navigate to a filing
let r = await ask("Open the 2025 Federal Form 1120 filing");
log("\n[1] NAV REPLY:", r.slice(0, 200));
await p.waitForSelector("[data-testid=filing-detail]", { timeout: 8000 }).catch(() => log("  (no filing-detail)"));
await shot("01-navigated-filing");
log("  filing-detail visible:", await p.locator("[data-testid=filing-detail]").isVisible().catch(() => false));

// 2) Create a filing
r = await ask("Create a filing for the Q3 2026 federal estimated payment, due 2026-09-15, assigned to me.");
log("\n[2] CREATE REPLY:", r.slice(0, 200));
await shot("02-created-filing");

// 3) Verify it appears in the Filings list
await p.click("[data-testid=nav--filings]");
await p.waitForSelector("[data-testid=filings-screen]", { timeout: 8000 });
await p.waitForTimeout(800);
const rowCount = await p.locator("[data-testid^=filing-row-]").count();
const listText = await p.locator("[data-testid=filings-table]").innerText().catch(() => "");
log("  filings rows:", rowCount, "| has Q3 2026:", /Q3 2026/.test(listText));
await shot("03-filings-list");

// 4) Add a checklist item to a filing
r = await ask("Add a checklist step to the California Form 100: confirm CA apportionment factors.");
log("\n[4] CHECKLIST REPLY:", r.slice(0, 200));
await p.waitForTimeout(800);
await shot("04-checklist-added");
const clCount = await p.locator("[data-testid=filing-checklist] [data-testid^=checklist-item-]").count();
log("  checklist items on detail:", clCount);

// 5) Draft a document
r = await ask("Draft a short 2025 corporate tax engagement letter and save it as engagement-letter.md.");
log("\n[5] DRAFT REPLY:", r.slice(0, 220));
await p.waitForTimeout(1500);
await shot("05-doc-drafted");

// 6) Verify it shows in Documents
await p.click("[data-testid=nav--documents]");
await p.waitForSelector("[data-testid=documents-screen]", { timeout: 8000 });
await p.waitForTimeout(800);
const genText = await p.locator("[data-testid=generated-group]").innerText().catch(() => "");
log("  generated docs has engagement-letter:", /engagement-letter/.test(genText));
await shot("06-documents");

// 7) Dashboard overdue check
await p.click("[data-testid=nav--dashboard]");
await p.waitForSelector("[data-testid=dashboard-screen]", { timeout: 8000 });
await p.waitForTimeout(600);
const overdueRows = await p.locator("[data-testid^=overdue-row-]").count();
log("\n[7] Dashboard overdue rows:", overdueRows);
await shot("07-dashboard-overdue");

await b.close();
log("\nDONE");
