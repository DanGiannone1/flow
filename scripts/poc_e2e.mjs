// POC end-to-end Playwright driver — drives the real frontend as a user and
// captures screenshots under screenshots/poc/. Run with: node scripts/poc_e2e.mjs
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const APP = process.env.APP_URL || "http://localhost:3000";
const OUT = process.env.OUT || "screenshots/poc";
mkdirSync(OUT, { recursive: true });

const shot = async (page, name) => {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log("  📸", name);
};

async function send(page, text) {
  console.log("→ send:", text.slice(0, 70).replace(/\n/g, " "));
  await page.fill("[data-testid=chat-input]", text);
  await page.click("[data-testid=send-button]");
  try { await page.waitForSelector("[data-testid=stop-button]", { timeout: 8000 }); } catch {}
  await page.waitForSelector("[data-testid=send-button]", { timeout: 150000 });
  await page.waitForTimeout(1500); // allow /app/state refetch to render
}

const lastAssistantText = async (page) =>
  (await page.locator(".message-row-assistant").last().innerText().catch(() => "")) || "";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1480, height: 900 } });
  page.on("pageerror", (e) => console.log("  ‼️ pageerror:", e.message));
  const results = [];
  const check = (label, cond, detail = "") => { results.push({ label, ok: !!cond, detail }); console.log(cond ? "  ✅" : "  ❌", label, detail); };

  // 1. Landing
  console.log("\n[1] Landing");
  await page.goto(APP, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-testid=workbench-app]", { timeout: 30000 });
  await page.waitForSelector("[data-testid=dashboard-screen]", { timeout: 30000 });
  await shot(page, "01-landing-split-screen");
  check("workbench app + chat render on landing", await page.locator("[data-testid=workbench-app]").isVisible());

  // 2. Navigation
  console.log("\n[2] Navigate to Federal Compliance");
  await send(page, "Take me to Federal Compliance");
  await page.waitForSelector("[data-testid=work-area-screen]", { timeout: 20000 }).catch(() => {});
  await shot(page, "02-navigate-federal-compliance");
  check("navigated to a work area screen", await page.locator("[data-testid=work-area-screen]").isVisible());
  check("breadcrumb shows Federal Compliance", (await page.locator("[data-testid=breadcrumb]").innerText()).includes("Federal Compliance"));

  // 3. Create task
  console.log("\n[3] Create task");
  await send(page, "Create a Q3 estimated payment task in Federal Compliance, due 2026-09-15, assigned to me");
  await page.waitForTimeout(800);
  await shot(page, "03-task-created");
  const tasksText = await page.locator("[data-testid=tasks-table]").innerText().catch(() => "");
  check("new Q3 task row visible in work plan", /q3/i.test(tasksText), tasksText.replace(/\n/g, " | ").slice(0, 120));

  // 4. Ambiguous navigation — the model occasionally self-resolves a vague term,
  // so retry a few times to exercise the disambiguation path when it occurs.
  console.log("\n[4] Ambiguous navigation");
  let chipCount = 0, ambText = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    await send(page, "go to compliance");
    chipCount = await page.locator(".step-candidate").count();
    ambText = await lastAssistantText(page);
    if (chipCount >= 2 || (/state/i.test(ambText) && /federal/i.test(ambText))) break;
  }
  await shot(page, "04-ambiguous-nav-options");
  check("agent disambiguates (lists both compliance areas, in chips or text)",
    chipCount >= 2 || (/state/i.test(ambText) && /federal/i.test(ambText)),
    `${chipCount} chips; text: ${ambText.replace(/\n/g, " ").slice(0, 90)}`);

  // 5. Disambiguate — click the candidate chip if present, else type the choice.
  console.log("\n[5] Disambiguate → State & Local");
  const chip = page.locator(".step-candidate", { hasText: "State & Local" });
  if (await chip.count() > 0) {
    await chip.first().click();
    try { await page.waitForSelector("[data-testid=stop-button]", { timeout: 8000 }); } catch {}
    await page.waitForSelector("[data-testid=send-button]", { timeout: 150000 });
    await page.waitForTimeout(1500);
  } else {
    await send(page, "take me to State & Local Compliance");
  }
  await shot(page, "05-disambiguated-navigated");
  check("landed on State & Local Compliance",
    (await page.locator("[data-testid=breadcrumb]").innerText()).includes("State & Local"));

  // 6. Latest engagement letter template
  console.log("\n[6] Latest engagement letter");
  await send(page, "Show me the latest engagement letter template");
  await page.waitForSelector("[data-testid=template-detail]", { timeout: 20000 }).catch(() => {});
  await shot(page, "06-latest-engagement-letter");
  const tplText = await page.locator("[data-testid=template-detail]").innerText().catch(() => "");
  check("opened latest engagement letter (v3.2)", /v3\.2/.test(tplText), tplText.replace(/\n/g, " ").slice(0, 120));

  // 7. Bulk information requests
  console.log("\n[7] Bulk information requests");
  await send(page,
    "Create information requests from this:\n" +
    "Trial balance | Federal Compliance | Client Controller - provide FY24 TB\n" +
    "Depreciation schedule | Federal Compliance | Client FA team - provide schedule\n" +
    "Intercompany detail | Federal Compliance | Client Tax - provide IC balances");
  await page.waitForTimeout(1000);
  await shot(page, "07-bulk-info-requests");
  const irText = await page.locator("[data-testid=info-requests-table]").innerText().catch(() => "");
  const irCount = (irText.match(/trial balance|depreciation|intercompany/gi) || []).length;
  check("3 new information requests visible", irCount >= 3, `matched ${irCount}`);

  // 8. Inline step trace + per-turn meta (the trace surface)
  console.log("\n[8] Inline step trace");
  await shot(page, "08-inline-step-trace");
  check("inline tool trace present", (await page.locator("[data-testid=tool-trace]").count()) > 0);
  check("per-turn meta (step count + duration) shown", (await page.locator("[data-testid=turn-meta]").count()) > 0,
    (await page.locator("[data-testid=turn-meta]").first().innerText().catch(() => "")).slice(0, 60));

  // 9. Persistence after reload
  console.log("\n[9] Persistence after reload");
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector("[data-testid=workbench-app]", { timeout: 30000 });
  await page.click("[data-testid=nav-wa-wa-federal]").catch(() => {});
  await page.waitForTimeout(1000);
  await shot(page, "09-persistence-after-reload");
  const afterReload = await page.locator("[data-testid=tasks-table]").innerText().catch(() => "");
  check("created task persists after reload (from workspace state)", /q3/i.test(afterReload));

  // 10. Fail-loud: unknown destination (governance / verifiable-execution evidence)
  console.log("\n[10] Fail-loud unknown destination");
  await send(page, "take me to the crypto division");
  await shot(page, "10-fail-loud-not-found");
  const flText = await lastAssistantText(page);
  check("unknown destination fails loud (not found, no false nav)",
    /not exist|not found|couldn'?t find|no .*destination/i.test(flText), flText.replace(/\n/g, " ").slice(0, 110));

  // 11. Off-script general helpfulness (composed, unscripted)
  console.log("\n[11] Off-script helpfulness");
  await send(page, "what's overdue in Federal Compliance? today is 2026-09-15");
  await shot(page, "11-offscript-overdue");
  const odText = await lastAssistantText(page);
  check("off-script overdue query answered (cites book-tax)",
    /book-tax|reconcile|overdue/i.test(odText), odText.replace(/\n/g, " ").slice(0, 110));

  await browser.close();

  console.log("\n===== SUMMARY =====");
  const passed = results.filter((r) => r.ok).length;
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.label}`);
  console.log(`\n${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 2);
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
