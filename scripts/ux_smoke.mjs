import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
const OUT = "review/ux-restructure/screens"; mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ headless: true });
const p = await b.newPage({ viewport: { width: 1480, height: 900 } });
const errs = []; p.on("pageerror", e => errs.push(e.message));
const shot = (n) => p.screenshot({ path: `${OUT}/${n}.png` });
let fails = 0; const ck = (n, ok, d="") => { console.log(`${ok?"✅":"❌"} ${n}${d?` — ${d}`:""}`); if(!ok) fails++; };

await p.goto("http://localhost:3000", { waitUntil: "networkidle" });
await p.waitForSelector("[data-testid=workbench-app]", { timeout: 30000 });
await p.waitForSelector("[data-testid=copilot-dock]", { timeout: 15000 }).catch(()=>{});
await p.waitForTimeout(800); await shot("1-host-with-dock");
ck("host app + docked co-pilot render", await p.locator("[data-testid=copilot-dock]").isVisible());

// collapse dock -> launcher
await p.click("[data-testid=dock-collapse]").catch(()=>{}); await p.waitForTimeout(500); await shot("2-dock-collapsed");
ck("dock collapses to launcher", await p.locator("[data-testid=dock-launcher]").isVisible() && await p.locator("[data-testid=copilot-dock]").count()===0);
await p.click("[data-testid=dock-launcher]").catch(()=>{}); await p.waitForTimeout(400);
ck("launcher reopens dock", await p.locator("[data-testid=copilot-dock]").isVisible());

// send a message in the dock, then expand to workspace -> conversation continues
await p.fill("[data-testid=chat-input]", "Take me to Federal Compliance");
await p.click("[data-testid=send-button]");
try { await p.waitForSelector("[data-testid=stop-button]", { timeout: 8000 }); } catch {}
await p.waitForSelector("[data-testid=send-button]", { timeout: 150000 }); await p.waitForTimeout(1500);
const dockMsgs = await p.locator(".message-row-user").count();
await shot("3-dock-after-nav");
ck("agent nav in dock works", (await p.locator("[data-testid=breadcrumb]").innerText().catch(()=> "")).includes("Federal"));

// expand to workspace
await p.click("[data-testid=dock-expand]"); await p.waitForTimeout(1200);
await p.waitForSelector("[data-testid=artifact-canvas]", { timeout: 10000 }).catch(()=>{});
await shot("4-assistant-workspace");
const wsMsgs = await p.locator(".message-row-user").count();
ck("workspace renders chat spine + artifact canvas", await p.locator("[data-testid=artifact-canvas]").isVisible());
ck("session continuous across surfaces (same msg count)", wsMsgs === dockMsgs && wsMsgs > 0, `dock=${dockMsgs} ws=${wsMsgs}`);

// generate an artifact in the workspace
await p.fill("[data-testid=chat-input]", "Write a short markdown file called engagement-summary.md summarizing the STC Demo federal engagement status");
await p.click("[data-testid=send-button]");
try { await p.waitForSelector("[data-testid=stop-button]", { timeout: 8000 }); } catch {}
await p.waitForSelector("[data-testid=send-button]", { timeout: 150000 }); await p.waitForTimeout(2000);
await shot("5-workspace-artifact");
ck("artifact appears in canvas", (await p.locator("[data-testid=artifact-viewer]").innerText().catch(()=> "")).length > 20);

// back to app
await p.click("[data-testid=workspace-back]"); await p.waitForTimeout(900);
await p.waitForSelector("[data-testid=workbench-app]", { timeout: 10000 });
await shot("6-back-to-host");
ck("back-to-app returns to host", await p.locator("[data-testid=workbench-app]").isVisible());

console.log(`\n${fails===0?"ALL PASS":fails+" FAILED"} | pageErrors ${errs.length}`);
errs.forEach(e=>console.log("  ‼️", e));
await b.close(); process.exit(fails>0||errs.length>0?1:0);
