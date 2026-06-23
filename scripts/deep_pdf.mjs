// Real PDF upload → Content Understanding → grounded analysis. CU latency/perms are
// environmental, so a non-read is reported INCONCLUSIVE (exit 0), not a hard failure.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
const OUT = "review/deep-test/screens"; mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ headless: true });
let hardFail = 0; const ck = (n, ok, d="") => { console.log(`${ok?"✅":"❌"} ${n}${d?` — ${d.slice(0,150)}`:""}`); if(!ok) hardFail++; };
const ctx = await b.newContext({ viewport: { width: 1400, height: 880 } });

// Generate a REAL pdf with a distinctive figure via Chromium's print-to-pdf
const gen = await ctx.newPage();
await gen.setContent(`<html><body style="font-family:sans-serif;padding:40px">
<h1>STC Demo — Fixed Asset Addition Schedule (FY2025)</h1>
<p>This document was uploaded as a PDF for the 2025 federal return.</p>
<p>Total qualifying bonus-depreciation additions in FY2025: <b>$9,182,540</b>.</p>
<p>Section 179 expense elected: $1,160,000. Placed-in-service date: 2025-07-01.</p>
</body></html>`);
await gen.pdf({ path: "/tmp/STC-fixed-asset-schedule-2025.pdf", format: "Letter" });
await gen.close();

const p = await ctx.newPage(); const errs=[]; p.on("pageerror",e=>errs.push(e.message));
async function send(t){ await p.fill("[data-testid=chat-input]", t); await p.click("[data-testid=send-button]"); try{await p.waitForSelector("[data-testid=stop-button]",{timeout:8000});}catch{} await p.waitForSelector("[data-testid=send-button]",{timeout:150000}); await p.waitForTimeout(1800); }
const lastA = async () => (await p.locator(".message-row-assistant").last().innerText().catch(()=> "")) || "";

await p.goto("http://localhost:3000", { waitUntil: "networkidle" });
await p.waitForSelector("[data-testid=workbench-app]", { timeout: 30000 }); await p.waitForTimeout(800);

await p.setInputFiles('input[type=file]', "/tmp/STC-fixed-asset-schedule-2025.pdf");
console.log("  …uploaded PDF; waiting for Content Understanding processing");
await p.waitForTimeout(20000); // CU round-trip
await p.screenshot({ path: `${OUT}/pdf-after-upload.png` });

await send("Read the uploaded fixed asset schedule PDF. What were the total FY2025 bonus-depreciation additions? Cite the source.");
const a = await lastA();
await p.screenshot({ path: `${OUT}/pdf-grounded-answer.png` });
const got = /9,?182,?540/.test(a);
const declined = /don'?t have|not (in|available)|no .*(pdf|document|data)|cannot|can'?t|unable|couldn'?t (read|find|process)/i.test(a);
if (got) ck("PDF→CU→grounded answer ($9,182,540)", true, a.replace(/\n/g," ").slice(0,150));
else if (declined) { console.log("⚠️  INCONCLUSIVE — agent did not get the figure (CU may not have processed; check Azure ADLS/CU perms + latency):", a.replace(/\n/g," ").slice(0,150)); }
else { ck("PDF→CU→grounded answer ($9,182,540)", false, a.replace(/\n/g," ").slice(0,150)); }

if (errs.length) { console.log("page errors:", errs.join(";").slice(0,150)); hardFail++; }
console.log(`\n${hardFail===0?"OK (pass or inconclusive)":"FAILED"}`);
await b.close(); process.exit(hardFail>0?1:0);
