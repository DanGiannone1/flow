// Verify the /assistant workspace artifact canvas renders a drafted document.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
const OUT = "review/verify"; mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ headless: true });
const p = await b.newPage({ viewport: { width: 1480, height: 920 } });

await p.goto("http://localhost:3000/assistant", { waitUntil: "networkidle" });
await p.waitForSelector("[data-testid=artifact-canvas]", { timeout: 30000 });
await p.waitForTimeout(1200);

await p.fill("[data-testid=chat-input]", "Draft a brief memo summarizing the FY2025 tax provision status and save it as provision-memo.md.");
await p.click("[data-testid=send-button]");
try { await p.waitForSelector("[data-testid=stop-button]", { timeout: 8000 }); } catch {}
await p.waitForSelector("[data-testid=send-button]", { timeout: 150000 });
await p.waitForTimeout(2500);

const reply = await p.locator(".message-row-assistant").last().innerText().catch(() => "");
console.log("REPLY:", reply.slice(0, 200));
const viewerVisible = await p.locator("[data-testid=artifact-viewer]").isVisible().catch(() => false);
const viewerText = await p.locator("[data-testid=artifact-viewer]").innerText().catch(() => "");
console.log("artifact-viewer visible:", viewerVisible);
console.log("viewer has provision content:", /provision|FY2025|tax/i.test(viewerText));
await p.screenshot({ path: `${OUT}/08-artifact-canvas.png` });
console.log("shot: 08-artifact-canvas.png");
await b.close();
