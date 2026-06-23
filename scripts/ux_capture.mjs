import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
const OUT = "review/ux-polish"; mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ headless: true });
async function shot(width, name, prep) {
  const ctx = await b.newContext({ viewport: { width, height: 900 } });
  const p = await ctx.newPage();
  await p.goto("http://localhost:3000", { waitUntil: "networkidle" });
  await p.waitForSelector("[data-testid=workbench-app]", { timeout: 30000 }).catch(()=>{});
  await p.waitForTimeout(900);
  if (prep) await prep(p);
  await p.screenshot({ path: `${OUT}/${name}-${width}.png` });
  await ctx.close();
  console.log(`  ${name} @ ${width}`);
}
// Landing (host + dock) across widths — responsiveness check
for (const w of [1440, 1280, 1024, 860, 680]) await shot(w, "landing", null);
// Work area (host content) 
for (const w of [1440, 1024]) await shot(w, "workarea", async (p)=>{ await p.click("[data-testid=nav-wa-wa-federal]").catch(()=>{}); await p.waitForTimeout(700); });
// Assistant workspace (3-col)
for (const w of [1440, 1100]) await shot(w, "workspace", async (p)=>{ await p.click("[data-testid=dock-expand]").catch(()=>{}); await p.waitForTimeout(1200); });
console.log("done");
await b.close();
