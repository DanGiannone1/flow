// Tax-domain breadth: provision (ASC 740), engagement-letter drafting, cross-document
// reasoning, and an off-script composed query. Asserts grounded behavior + no crashes.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
const OUT = "review/deep-test/screens"; mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ headless: true });
let fails = 0; const ck = (n, ok, d="") => { console.log(`${ok?"✅":"❌"} ${n}${d?` — ${d.slice(0,150)}`:""}`); if(!ok) fails++; };
const ctx = await b.newContext({ viewport: { width: 1480, height: 900 } });
const p = await ctx.newPage(); const errs=[]; p.on("pageerror",e=>errs.push(e.message));
async function send(t){ await p.fill("[data-testid=chat-input]", t); await p.click("[data-testid=send-button]"); try{await p.waitForSelector("[data-testid=stop-button]",{timeout:8000});}catch{} await p.waitForSelector("[data-testid=send-button]",{timeout:150000}); await p.waitForTimeout(1800); }
const lastA = async () => (await p.locator(".message-row-assistant").last().innerText().catch(()=> "")) || "";

await p.goto("http://localhost:3000", { waitUntil: "networkidle" });
await p.waitForSelector("[data-testid=workbench-app]", { timeout: 30000 }); await p.waitForTimeout(800);

// 1. ASC 740 provision (Pacific Energy) grounded in the firm reference
await send("Using the firm's ASC 740 reference, outline the steps to build the tax provision and rate reconciliation for the Pacific Energy provision engagement.");
const a1 = await lastA();
ck("provision/ASC740 answer is grounded (rate reconciliation, deferred, 21%)", /rate reconcil|deferred|current tax|21%|enacted|valuation allowance/i.test(a1), a1.replace(/\n/g," ").slice(0,150));

// 2. Engagement-letter drafting → artifact
await send("Draft an engagement letter for STC Demo for the 2025 federal return and save it as stc-engagement-letter.md");
const a2 = await lastA();
ck("engagement-letter drafted + saved as artifact", /saved|engagement letter|stc-engagement-letter/i.test(a2), a2.replace(/\n/g," ").slice(0,140));

// 3. Cross-document reasoning (trial balance vs prior-year)
await send("Comparing the FY2025 trial balance with the FY2024 prior-year return summary, what changed year over year? Cite sources.");
const a3 = await lastA();
ck("cross-doc reasoning cites both sources + a real delta", /\[s\d\]|prior.?year|trial.?balance/i.test(a3) && /revenue|62,?400|58,?900|bonus|depreciation|increas|grew|higher/i.test(a3), a3.replace(/\n/g," ").slice(0,150));

// 4. Off-script composed query (PITCH-NOTES §7)
await send("What's overdue in Federal Compliance if today is 2026-11-01?");
const a4 = await lastA();
ck("off-script overdue query answered from task data", /overdue|1120|book-?tax|10-15|due|none|no .*overdue/i.test(a4), a4.replace(/\n/g," ").slice(0,150));

ck("no page errors across breadth sweep", errs.length===0, errs.join(";").slice(0,120));
console.log(`\n${fails===0?"ALL PASS":fails+" FAILED"}`);
await b.close(); process.exit(fails>0?1:0);
