// Reviewer live-probe tool: send one prompt to the assistant and print its reply + the
// tool trace, saving a screenshot. Usage: node scripts/probe.mjs "your question" [outname]
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
const prompt = process.argv[2];
const outname = process.argv[3] || "probe";
if (!prompt) { console.error('usage: node scripts/probe.mjs "prompt" [outname]'); process.exit(2); }
const OUT = "review/critique-probes"; mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ headless: true });
const p = await b.newPage({ viewport: { width: 1480, height: 900 } });
await p.goto("http://localhost:3000", { waitUntil: "networkidle" });
await p.waitForSelector("[data-testid=workbench-app]", { timeout: 30000 });
await p.waitForTimeout(800);
await p.fill("[data-testid=chat-input]", prompt);
await p.click("[data-testid=send-button]");
try { await p.waitForSelector("[data-testid=stop-button]", { timeout: 8000 }); } catch {}
await p.waitForSelector("[data-testid=send-button]", { timeout: 150000 });
await p.waitForTimeout(2000);
const reply = await p.locator(".message-row-assistant").last().innerText().catch(()=> "");
await p.screenshot({ path: `${OUT}/${outname}.png` });
console.log("PROMPT:", prompt);
console.log("REPLY:\n" + reply);
console.log(`screenshot: ${OUT}/${outname}.png`);
await b.close();
