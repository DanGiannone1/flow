import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
const OUT = "review/deep-test/screens"; mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ headless: true });
let fails = 0; const ck = (n, ok, d="") => { console.log(`${ok?"✅":"❌"} ${n}${d?` — ${d.slice(0,120)}`:""}`); if(!ok) fails++; };
async function send(p,t){ await p.fill("[data-testid=chat-input]", t); await p.click("[data-testid=send-button]"); try{await p.waitForSelector("[data-testid=stop-button]",{timeout:8000});}catch{} await p.waitForSelector("[data-testid=send-button]",{timeout:150000}); await p.waitForTimeout(1200); }

// 1. Deep-link straight to /assistant on a fresh context (no prior session)
{
  const ctx = await b.newContext({ viewport: { width: 1400, height: 880 } });
  const p = await ctx.newPage(); const errs=[]; p.on("pageerror",e=>errs.push(e.message));
  await p.goto("http://localhost:3000/assistant", { waitUntil: "networkidle" });
  const ok = await p.waitForSelector("[data-testid=artifact-canvas]", { timeout: 30000 }).then(()=>true).catch(()=>false);
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${OUT}/edge-deeplink.png` });
  const inputReady = await p.locator("[data-testid=chat-input]").count() > 0;
  ck("deep-link /assistant boots a usable workspace", ok && inputReady && errs.length===0, `canvas=${ok} input=${inputReady} errs=${errs.length}`);
  await ctx.close();
}

// 2. Reload while ON /assistant — should stay usable (and ideally not bounce away unexpectedly)
{
  const ctx = await b.newContext({ viewport: { width: 1400, height: 880 } });
  const p = await ctx.newPage(); const errs=[]; p.on("pageerror",e=>errs.push(e.message));
  await p.goto("http://localhost:3000", { waitUntil: "networkidle" });
  await p.waitForSelector("[data-testid=workbench-app]", { timeout: 30000 });
  await p.waitForTimeout(600);
  await p.click("[data-testid=dock-expand]"); await p.waitForTimeout(1000);
  await p.waitForSelector("[data-testid=artifact-canvas]", { timeout: 10000 });
  await p.reload({ waitUntil: "networkidle" }); await p.waitForTimeout(2500);
  await p.screenshot({ path: `${OUT}/edge-reload-assistant.png` });
  const url = p.url();
  const usable = await p.locator("[data-testid=chat-input]").count() > 0;
  ck("reload on /assistant lands usable (no crash/stuck)", usable && errs.length===0, `url=${url} usable=${usable} errs=${errs.length}`);
  await ctx.close();
}

// 3. New Session FROM the workspace + 4. Stop mid-stream in the workspace
{
  const ctx = await b.newContext({ viewport: { width: 1400, height: 880 } });
  const p = await ctx.newPage(); const errs=[]; p.on("pageerror",e=>errs.push(e.message));
  await p.goto("http://localhost:3000", { waitUntil: "networkidle" });
  await p.waitForSelector("[data-testid=workbench-app]", { timeout: 30000 });
  await p.waitForTimeout(600);
  await send(p, "Create a task called WS-EDGE-MARKER in Federal Compliance assigned to me");
  await p.click("[data-testid=dock-expand]"); await p.waitForTimeout(1000);
  // Stop mid-stream in workspace
  await p.fill("[data-testid=chat-input]", "Write an extremely long multi-section narrative about every client and engagement in exhaustive detail");
  await p.click("[data-testid=send-button]");
  await p.waitForSelector("[data-testid=stop-button]", { timeout: 8000 }).catch(()=>{});
  await p.waitForTimeout(600);
  await p.click("[data-testid=stop-button]").catch(()=>{});
  await p.waitForTimeout(1200);
  const recovered = await p.locator("[data-testid=send-button]").count() > 0;
  ck("stop mid-stream in workspace halts + recovers", recovered, `sendBtn=${recovered}`);
  // New Session from workspace
  await p.click("[data-testid=new-chat-button]").catch(()=>{});
  await p.waitForTimeout(700);
  const confirm = p.getByRole("button", { name: "Start new session", exact: true });
  if (await confirm.count() > 0) await confirm.first().click().catch(()=>{});
  await p.waitForTimeout(3000);
  await p.screenshot({ path: `${OUT}/edge-newsession-from-ws.png` });
  const url2 = p.url();
  const usable2 = await p.locator("[data-testid=chat-input]").count() > 0;
  // after reset, marker should be gone (check via host federal)
  if (url2.includes("/assistant")) { await p.click("[data-testid=nav-wa-wa-federal]").catch(()=>{}); await p.waitForTimeout(1000); }
  else { await p.click("[data-testid=nav-wa-wa-federal]").catch(()=>{}); await p.waitForTimeout(1000); }
  const fed = await p.locator("[data-testid=tasks-table]").innerText().catch(()=> "");
  ck("new session from workspace resets + stays usable", usable2 && !/ws-edge-marker/i.test(fed), `url=${url2} usable=${usable2} markerGone=${!/ws-edge-marker/i.test(fed)}`);
  ck("no page errors across workspace edges", errs.length===0, errs.join(";").slice(0,120));
  await ctx.close();
}

console.log(`\n${fails===0?"ALL PASS":fails+" FAILED"}`);
await b.close(); process.exit(fails>0?1:0);
