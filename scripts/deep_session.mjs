// Determinism of tax-correctness across phrasings + multiple-artifact canvas.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
const OUT = "review/deep-test/screens"; mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ headless: true });
let fails = 0; const ck = (n, ok, d="") => { console.log(`${ok?"✅":"❌"} ${n}${d?` — ${d.slice(0,160)}`:""}`); if(!ok) fails++; };
const ctx = await b.newContext({ viewport: { width: 1480, height: 900 } });
const p = await ctx.newPage(); const errs=[]; p.on("pageerror",e=>errs.push(e.message));
async function send(t){ await p.fill("[data-testid=chat-input]", t); await p.click("[data-testid=send-button]"); try{await p.waitForSelector("[data-testid=stop-button]",{timeout:8000});}catch{} await p.waitForSelector("[data-testid=send-button]",{timeout:150000}); await p.waitForTimeout(2000); }

await p.goto("http://localhost:3000", { waitUntil: "networkidle" });
await p.waitForSelector("[data-testid=workbench-app]", { timeout: 30000 }); await p.waitForTimeout(800);

// Two M-1 analyses with DIFFERENT phrasings → both must avoid the state-tax add-back error
await send("Review the trial balance and prepare the Schedule M-1 book-tax adjustments for STC Demo. Save as m1-v1.md");
await send("Now do an independent book-to-tax reconciliation for the STC federal return from the trial balance and firm policy. Save as m1-v2.md");
// A third, different deliverable for multi-artifact
await send("Summarize the outstanding PBC items for the STC federal return. Save as pbc-status.md");

await p.click("[data-testid=dock-expand]"); await p.waitForTimeout(1500);
await p.waitForSelector("[data-testid=artifact-canvas]", { timeout: 10000 });
// multi-artifact rail should now exist (>1 artifact)
const railCount = await p.locator('[data-testid^="artifact-"]').count();
await p.screenshot({ path: `${OUT}/deep-multi-artifact.png` });
ck("multiple artifacts listed in canvas rail (>1)", railCount >= 2, `rail items=${railCount}`);

// read each M-1 artifact, assert NO state-income-tax add-back (the prior BLOCKER) in either
async function artifactText(name) {
  const item = p.locator(`[data-testid="artifact-${name}"]`);
  if (await item.count() === 0) return "(missing)";
  await item.first().click(); await p.waitForTimeout(900);
  return (await p.locator("[data-testid=artifact-viewer]").innerText().catch(()=> "")) || "";
}
const stateAddBack = (t) => /state\s+(income\s+)?tax[^.\n]{0,60}(add\s*back|add back|disallow|not deductible|permanent)/i.test(t)
  || /(add\s*back|permanent)[^.\n]{0,40}state\s+(income\s+)?tax/i.test(t);
const v1 = await artifactText("m1-v1.md");
const v2 = await artifactText("m1-v2.md");
ck("m1-v1 has NO wrong state-income-tax add-back", v1 !== "(missing)" && !stateAddBack(v1), v1==="(missing)"?"artifact missing":v1.replace(/\n/g," ").slice(0,140));
ck("m1-v2 has NO wrong state-income-tax add-back (determinism)", v2 !== "(missing)" && !stateAddBack(v2), v2==="(missing)"?"artifact missing":v2.replace(/\n/g," ").slice(0,140));
ck("both M-1 artifacts cite sources", /sources|\[s\d\]/i.test(v1) && /sources|\[s\d\]/i.test(v2));
ck("no page errors across deep session", errs.length===0, errs.join(";").slice(0,120));

console.log(`\n${fails===0?"ALL PASS":fails+" FAILED"}`);
await b.close(); process.exit(fails>0?1:0);
