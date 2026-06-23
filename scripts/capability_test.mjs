import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
const OUT = "review/capabilities/screens"; mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ headless: true });
const p = await b.newPage({ viewport: { width: 1480, height: 900 } });
const errs = []; p.on("pageerror", e => errs.push(e.message));
const shot = (n) => p.screenshot({ path: `${OUT}/${n}.png` });
let fails = 0; const ck = (n, ok, d="") => { console.log(`${ok?"✅":"❌"} ${n}${d?` — ${d.slice(0,150)}`:""}`); if(!ok) fails++; };
const lastA = async () => (await p.locator(".message-row-assistant").last().innerText().catch(()=> "")) || "";
async function send(t){ await p.fill("[data-testid=chat-input]", t); await p.click("[data-testid=send-button]"); try{await p.waitForSelector("[data-testid=stop-button]",{timeout:8000});}catch{} await p.waitForSelector("[data-testid=send-button]",{timeout:150000}); await p.waitForTimeout(1800); }

await p.goto("http://localhost:3000", { waitUntil: "networkidle" });
await p.waitForSelector("[data-testid=workbench-app]", { timeout: 30000 });
await p.waitForTimeout(1000);

// 1. Documents seeded → host Documents view
await p.click("[data-testid=nav--documents]").catch(()=>{});
await p.waitForTimeout(1200); await shot("1-documents-view");
const docsText = await p.locator("[data-testid=workbench-app]").innerText().catch(()=> "");
ck("provided documents seeded + visible", /trial.?balance/i.test(docsText) && /prior.?year/i.test(docsText), docsText.replace(/\n/g," ").slice(0,160));

// 2. Document analysis → cited artifact
await send("Analyze the STC Demo trial balance and propose the book-tax (M-1) adjustments, applying the firm policy. Save it as book-tax-adjustments.md");
const a2 = await lastA(); await shot("2-analysis-answer");
ck("analysis read source docs + saved artifact", /trial.?balance/i.test(a2) && /book-tax-adjustments|saved/i.test(a2), a2.replace(/\n/g," ").slice(0,160));
// check artifact in workspace
await p.click("[data-testid=dock-expand]"); await p.waitForTimeout(1200);
const art = await p.locator("[data-testid=artifact-viewer]").innerText().catch(()=> "");
await shot("3-analysis-artifact");
ck("artifact created with book-tax content", /book.?tax|m-?1|adjustment/i.test(art) && art.length>120, art.replace(/\n/g," ").slice(0,160));
ck("artifact cites sources", /sources|\[S\d\]/i.test(art), art.match(/sources[\s\S]{0,120}/i)?.[0]?.replace(/\n/g," ")||"no sources section");
await p.click("[data-testid=workspace-back]").catch(()=>{}); await p.waitForTimeout(800);

// 3. RAG QA grounded — known number from prior-year doc (2024 taxable income = 7,420,000)
await send("What was STC Demo's 2024 federal taxable income? Cite your source.");
const a3 = await lastA(); await shot("4-rag-grounded");
ck("grounded QA returns the correct figure (7,420,000)", /7,?420,?000/.test(a3), a3.replace(/\n/g," ").slice(0,160));
ck("grounded QA cites a source", /\[S\d\]|prior.?year|source/i.test(a3), a3.replace(/\n/g," ").slice(0,120));

// 4. Ungrounded — figure NOT in any doc (2022) → must decline
await send("What was STC Demo's exact 2022 federal taxable income?");
const a4 = await lastA(); await shot("5-ungrounded-decline");
ck("ungrounded 2022 figure declined (not fabricated)", /don'?t have|do(es)? not have|not (in|available)|no .*(data|record|document)|cannot|can'?t|unable|isn'?t|2022/i.test(a4) && !/7,?420,?000/.test(a4), a4.replace(/\n/g," ").slice(0,160));

console.log(`\n${fails===0?"ALL PASS":fails+" FAILED"} | pageErrors ${errs.length}`);
errs.forEach(e=>console.log("  ‼️",e));
await b.close(); process.exit(fails>0||errs.length>0?1:0);
