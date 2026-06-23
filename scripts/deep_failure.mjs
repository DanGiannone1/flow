// Failure injection via interception with TOGGLE flags (so faults lift deterministically).
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
const OUT = "review/deep-test/screens"; mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ headless: true });
let fails = 0; const ck = (n, ok, d="") => { console.log(`${ok?"✅":"❌"} ${n}${d?` — ${d.slice(0,150)}`:""}`); if(!ok) fails++; };
const ctx = await b.newContext({ viewport: { width: 1300, height: 850 } });
const p = await ctx.newPage();
const errs = []; p.on("pageerror", e => errs.push(e.message));
async function send(t){ await p.fill("[data-testid=chat-input]", t); await p.click("[data-testid=send-button]"); try{await p.waitForSelector("[data-testid=stop-button]",{timeout:8000});}catch{} await p.waitForSelector("[data-testid=send-button]",{timeout:150000}); await p.waitForTimeout(1500); }
const tasksText = () => p.locator("[data-testid=tasks-table]").innerText().catch(()=> "");
const ssId = () => p.evaluate(() => sessionStorage.getItem("tax_workbench_session_id"));

// Toggle-able faults installed ONCE
let probeFault = false, sendFault = false;
await p.route(/\/sessions\/[^/]+$/, (route) => (probeFault && route.request().method() === "GET")
  ? route.fulfill({ status: 500, contentType: "application/json", body: '{"detail":"transient"}' }) : route.continue());
await p.route(/\/sessions\/[^/]+\/messages$/, (route) => sendFault
  ? route.fulfill({ status: 500, contentType: "application/json", body: '{"detail":"boom"}' }) : route.continue());

await p.goto("http://localhost:3000", { waitUntil: "networkidle" });
await p.waitForSelector("[data-testid=workbench-app]", { timeout: 30000 });
await p.waitForTimeout(800);
await send("Create a task called RECOVER-MARKER in Federal Compliance due 2026-12-09 assigned to me");
const idBefore = await ssId();
ck("session established + marker created", !!idBefore);

// F3: transient probe fault on reload → must show Retry, NOT wipe
probeFault = true;
await p.reload({ waitUntil: "networkidle" }); await p.waitForTimeout(2500);
await p.screenshot({ path: `${OUT}/fail-F3-error.png` });
const retryVisible = await p.getByRole("button", { name: /retry/i }).count() > 0;
ck("F3: transient probe error shows Retry (not silent wipe)", retryVisible);
ck("F3: session id RETAINED (not deleted)", (await ssId()) === idBefore, `before=${idBefore} during=${await ssId()}`);

// lift the fault, click Retry → SAME session + marker present
probeFault = false;
if (retryVisible) await p.getByRole("button", { name: /retry/i }).first().click().catch(()=>{});
await p.waitForSelector("[data-testid=chat-input]", { timeout: 30000 }).catch(()=>{});
await p.waitForTimeout(1500);
await p.click("[data-testid=nav-wa-wa-federal]").catch(()=>{});
await p.waitForTimeout(1500);
await p.screenshot({ path: `${OUT}/fail-F3-recovered.png` });
ck("F3: SAME session restored (id unchanged)", (await ssId()) === idBefore);
ck("F3: marker task survived (NOT wiped)", /recover-marker/i.test(await tasksText()), (await tasksText()).replace(/\n/g," ").slice(0,120));

// Send-failure: 500 on POST /messages → fails loud + recovers
sendFault = true;
await p.fill("[data-testid=chat-input]", "this should fail");
await p.click("[data-testid=send-button]");
await p.waitForSelector("[data-testid=send-button]", { timeout: 60000 }).catch(()=>{});
await p.waitForTimeout(1500);
await p.screenshot({ path: `${OUT}/fail-send-error.png` });
const lastMsg = await p.locator(".message-row-assistant").last().innerText().catch(()=> "");
ck("send-failure shows an error (fails loud)", /error|failed|wrong|unable|500|try again/i.test(lastMsg), lastMsg.replace(/\n/g," ").slice(0,120));
ck("send-failure leaves input usable (not stuck)", await p.locator("[data-testid=send-button]").count() > 0 && !(await p.locator("[data-testid=chat-input]").isDisabled().catch(()=>true)));
sendFault = false;
await send("Take me to Federal Compliance");
ck("recovers: real send works after a failed send", (await p.locator("[data-testid=breadcrumb]").innerText().catch(()=> "")).includes("Federal"));

ck("no uncaught page errors", errs.length===0, errs.join("; ").slice(0,150));
console.log(`\n${fails===0?"ALL PASS":fails+" FAILED"}`);
await b.close(); process.exit(fails>0?1:0);
