// Exploratory, UNSCRIPTED drive of the POC — ad-hoc questions a real user might
// ask (general helpfulness, multi-turn continuity, edge cases). Captures screenshots
// + the agent's actual replies for manual examination.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const APP = process.env.APP_URL || "http://localhost:3000";
const OUT = "screenshots/explore";
mkdirSync(OUT, { recursive: true });

async function send(page, text) {
  await page.fill("[data-testid=chat-input]", text);
  await page.click("[data-testid=send-button]");
  try { await page.waitForSelector("[data-testid=stop-button]", { timeout: 8000 }); } catch {}
  await page.waitForSelector("[data-testid=send-button]", { timeout: 150000 });
  await page.waitForTimeout(1500);
}
const lastReply = async (page) =>
  (await page.locator(".message-row-assistant").last().innerText().catch(() => "")).replace(/\s+/g, " ").trim();

const PROMPTS = [
  "What can you help me with?",
  "Which federal obligations are due before October 1st, and which are still not started?",
  "Create a task in International Tax to document transfer pricing, due 2026-11-30",
  "actually assign that to me and mark it in progress",
  "Add two information requests to Workpapers: prior-year workpapers from the client, and the fixed asset rollforward from the controller",
  "what's the gist of the latest engagement letter?",
  "take me somewhere that doesn't exist, like the crypto division",
];

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1480, height: 900 } });
  page.on("pageerror", (e) => console.log("  ‼️ pageerror:", e.message));
  await page.goto(APP, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-testid=workbench-app]", { timeout: 30000 });

  for (let i = 0; i < PROMPTS.length; i++) {
    const p = PROMPTS[i];
    console.log(`\n[${i + 1}] USER: ${p}`);
    await send(page, p);
    const reply = await lastReply(page);
    console.log(`    ASSISTANT: ${reply.slice(0, 400)}`);
    await page.screenshot({ path: `${OUT}/q${String(i + 1).padStart(2, "0")}.png` });
  }
  // capture final app state
  await browser.close();
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
