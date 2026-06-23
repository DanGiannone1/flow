// Capture a coherent current-state walkthrough of the tax experience for reviewers.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
const OUT = process.env.OUT || "review/critique-1/showcase"; mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ headless: true });
const p = await b.newPage({ viewport: { width: 1480, height: 900 } });
const shot = (n) => p.screenshot({ path: `${OUT}/${n}.png` });
async function send(t){ await p.fill("[data-testid=chat-input]", t); await p.click("[data-testid=send-button]"); try{await p.waitForSelector("[data-testid=stop-button]",{timeout:8000});}catch{} await p.waitForSelector("[data-testid=send-button]",{timeout:150000}); await p.waitForTimeout(1800); }

await p.goto("http://localhost:3000", { waitUntil: "networkidle" });
await p.waitForSelector("[data-testid=workbench-app]", { timeout: 30000 }); await p.waitForTimeout(800);
await shot("01-landing-dock");
await p.click("[data-testid=dock-collapse]").catch(()=>{}); await p.waitForTimeout(500); await shot("02-app-fullwidth");
await p.click("[data-testid=dock-launcher]").catch(()=>{}); await p.waitForTimeout(400);
await p.click("[data-testid=nav-wa-wa-federal]").catch(()=>{}); await p.waitForTimeout(800); await shot("03-work-area");
await send("Analyze the STC Demo trial balance and propose the Schedule M-1 book-tax adjustments per firm policy. Save as m1.md");
await p.click("[data-testid=dock-expand]").catch(()=>{}); await p.waitForTimeout(1500); await shot("04-analysis-artifact");
await send("What was STC Demo's 2024 federal taxable income? Cite the source."); await shot("05-rag-grounded");
await send("What was STC Demo's exact 2021 taxable income?"); await shot("06-ungrounded-decline");
await send("Draft the engagement letter for STC Demo TY2025 and save as eng-letter.md"); await p.waitForTimeout(800); await shot("07-eng-letter-artifact");
await send("Using the firm ASC 740 reference, outline the provision and rate reconciliation steps for Pacific Energy."); await shot("08-provision");
await p.click("[data-testid=nav--documents]").catch(()=>{}); await p.waitForTimeout(1000); await shot("09-documents");
console.log("showcase captured to", OUT);
await b.close();
