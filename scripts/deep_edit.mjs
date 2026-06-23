// Artifact editing (§10.4): generate an editable artifact, edit it in the canvas, save,
// and confirm the edit PERSISTS server-side (survives reload).
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
const OUT = "review/deep-test/screens"; mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ headless: true });
let fails = 0; const ck = (n, ok, d="") => { console.log(`${ok?"✅":"❌"} ${n}${d?` — ${d.slice(0,140)}`:""}`); if(!ok) fails++; };
const ctx = await b.newContext({ viewport: { width: 1480, height: 900 } });
const p = await ctx.newPage(); const errs=[]; p.on("pageerror",e=>errs.push(e.message));
async function send(t){ await p.fill("[data-testid=chat-input]", t); await p.click("[data-testid=send-button]"); try{await p.waitForSelector("[data-testid=stop-button]",{timeout:8000});}catch{} await p.waitForSelector("[data-testid=send-button]",{timeout:150000}); await p.waitForTimeout(1800); }
const MARKER = "EDIT-PERSIST-MARKER-7788";

await p.goto("http://localhost:3000", { waitUntil: "networkidle" });
await p.waitForSelector("[data-testid=workbench-app]", { timeout: 30000 }); await p.waitForTimeout(800);
await send("Draft a short engagement letter for STC Demo for tax year 2025 and save it as engagement-letter-draft.md");
await p.click("[data-testid=dock-expand]"); await p.waitForTimeout(1500);
await p.waitForSelector("[data-testid=artifact-canvas]", { timeout: 10000 });

// Edit
const editBtn = p.locator("[data-testid=artifact-edit]");
ck("Edit control present for a markdown artifact", await editBtn.count() > 0);
await editBtn.first().click(); await p.waitForTimeout(500);
const ta = p.locator("[data-testid=artifact-editor]");
ck("editor textarea appears", await ta.count() > 0);
const cur = await ta.inputValue();
await ta.fill(cur + `\n\n## Reviewer note\n${MARKER}\n`);
await p.click("[data-testid=artifact-save]");
await p.waitForTimeout(2000);
await p.screenshot({ path: `${OUT}/edit-saved.png` });
const afterSave = await p.locator("[data-testid=artifact-viewer]").innerText().catch(()=> "");
ck("edit visible after Save", afterSave.includes(MARKER), afterSave.replace(/\n/g," ").slice(0,120));

// Persistence: reload, reopen the artifact, marker must still be there (proves server write).
// We're on /assistant; reloading there correctly STAYS in the workspace (no eject), so wait
// for the artifact canvas directly rather than the host workbench.
await p.reload({ waitUntil: "networkidle" });
await p.waitForSelector("[data-testid=artifact-canvas]", { timeout: 30000 }).catch(async () => {
  // If we somehow landed on the host, expand back into the workspace.
  await p.click("[data-testid=dock-expand]").catch(() => {});
  await p.waitForSelector("[data-testid=artifact-canvas]", { timeout: 10000 }).catch(() => {});
});
await p.waitForTimeout(1500);
// select the engagement letter (rail may exist if >1 artifact)
const item = p.locator('[data-testid="artifact-engagement-letter-draft.md"]');
if (await item.count() > 0) { await item.first().click(); await p.waitForTimeout(900); }
const afterReload = await p.locator("[data-testid=artifact-viewer]").innerText().catch(()=> "");
await p.screenshot({ path: `${OUT}/edit-persisted.png` });
ck("edit PERSISTED across reload (server write)", afterReload.includes(MARKER), afterReload.replace(/\n/g," ").slice(0,120));
ck("no page errors", errs.length===0, errs.join(";").slice(0,120));

console.log(`\n${fails===0?"ALL PASS":fails+" FAILED"}`);
await b.close(); process.exit(fails>0?1:0);
