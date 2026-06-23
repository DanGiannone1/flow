import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
const OUT = "review/deep-test/screens"; mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ headless: true });
let fails = 0; const ck = (n, ok, d="") => { console.log(`${ok?"✅":"❌"} ${n}${d?` — ${d.slice(0,160)}`:""}`); if(!ok) fails++; };
const ctx = await b.newContext({ viewport: { width: 1400, height: 880 } });
const p = await ctx.newPage(); const errs=[]; p.on("pageerror",e=>errs.push(e.message));
async function send(t){ await p.fill("[data-testid=chat-input]", t); await p.click("[data-testid=send-button]"); try{await p.waitForSelector("[data-testid=stop-button]",{timeout:8000});}catch{} await p.waitForSelector("[data-testid=send-button]",{timeout:150000}); await p.waitForTimeout(1500); }
const lastA = async () => (await p.locator(".message-row-assistant").last().innerText().catch(()=> "")) || "";

await p.goto("http://localhost:3000", { waitUntil: "networkidle" });
await p.waitForSelector("[data-testid=workbench-app]", { timeout: 30000 }); await p.waitForTimeout(800);

// upload a brand-new document via the hidden file input
await p.setInputFiles('input[type=file]', "/tmp/STC-RnD-credit-memo-2025.md");
await p.waitForTimeout(2000);
await p.screenshot({ path: `${OUT}/upload-after.png` });

// ask the agent a fact ONLY in the uploaded doc (this turn also forces a file refresh on RUN_FINISHED)
await send("Per the uploaded R&D credit memo, what is STC Demo's preliminary 2025 federal R&D credit? Cite the source.");
const a = await lastA();
await p.screenshot({ path: `${OUT}/upload-grounded-answer.png` });
ck("agent answers from the UPLOADED doc (312,400)", /312,?400/.test(a), a.replace(/\n/g," ").slice(0,160));
ck("agent cites the uploaded source", /\[s\d\]|memo|r&d|uploaded|source/i.test(a), a.replace(/\n/g," ").slice(0,120));

// the uploaded doc must surface in the Documents view (refreshed post-turn); poll a bit for safety
await p.click("[data-testid=nav--documents]").catch(()=>{});
let docs = "", appeared = false;
for (let i = 0; i < 8; i++) {
  await p.waitForTimeout(1500);
  docs = await p.locator("[data-testid=workbench-app]").innerText().catch(()=> "");
  if (/r&d|rnd|r-and-d|credit-memo/i.test(docs)) { appeared = true; break; }
}
await p.screenshot({ path: `${OUT}/upload-documents-view.png` });
ck("uploaded doc appears in Documents view", appeared, docs.replace(/\n/g," ").slice(0,150));
ck("no page errors", errs.length===0, errs.join(";").slice(0,120));

console.log(`\n${fails===0?"ALL PASS":fails+" FAILED"}`);
await b.close(); process.exit(fails>0?1:0);
