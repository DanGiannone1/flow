// Multi-session isolation + concurrency: two independent browser contexts (two sandboxes)
// acting at the same time must NOT see each other's data.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
const OUT = "review/deep-test/screens"; mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ headless: true });
let fails = 0; const ck = (n, ok, d="") => { console.log(`${ok?"✅":"❌"} ${n}${d?` — ${d.slice(0,140)}`:""}`); if(!ok) fails++; };

async function newUser() {
  const ctx = await b.newContext({ viewport: { width: 1300, height: 850 } }); // fresh storage = new session
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", e => errs.push(e.message));
  await p.goto("http://localhost:3000", { waitUntil: "networkidle" });
  await p.waitForSelector("[data-testid=workbench-app]", { timeout: 30000 });
  await p.waitForTimeout(800);
  return { ctx, p, errs };
}
async function send(p, t){ await p.fill("[data-testid=chat-input]", t); await p.click("[data-testid=send-button]"); try{await p.waitForSelector("[data-testid=stop-button]",{timeout:8000});}catch{} await p.waitForSelector("[data-testid=send-button]",{timeout:150000}); await p.waitForTimeout(1500); }
const tasksText = (p) => p.locator("[data-testid=tasks-table]").innerText().catch(()=> "");

const A = await newUser();
const B = await newUser();
// concurrent: both create a uniquely-named task in Federal at the same time
await Promise.all([
  send(A.p, "Create a task called ALPHA-ONLY-MARKER in Federal Compliance due 2026-12-01 assigned to me"),
  send(B.p, "Create a task called BRAVO-ONLY-MARKER in Federal Compliance due 2026-12-02 assigned to me"),
]);
// navigate both to Federal to read the work plan
await Promise.all([ send(A.p, "Take me to Federal Compliance"), send(B.p, "Take me to Federal Compliance") ]);
await A.p.screenshot({ path: `${OUT}/iso-A.png` }); await B.p.screenshot({ path: `${OUT}/iso-B.png` });
const aTxt = await tasksText(A.p), bTxt = await tasksText(B.p);
ck("A sees its own ALPHA task", /alpha-only/i.test(aTxt), aTxt.replace(/\n/g," ").slice(0,120));
ck("A does NOT see B's BRAVO task (isolation)", !/bravo-only/i.test(aTxt));
ck("B sees its own BRAVO task", /bravo-only/i.test(bTxt), bTxt.replace(/\n/g," ").slice(0,120));
ck("B does NOT see A's ALPHA task (isolation)", !/alpha-only/i.test(bTxt));
ck("no page errors in either session", A.errs.length===0 && B.errs.length===0, `A:${A.errs.length} B:${B.errs.length}`);

console.log(`\n${fails===0?"ALL PASS":fails+" FAILED"}`);
await b.close(); process.exit(fails>0?1:0);
