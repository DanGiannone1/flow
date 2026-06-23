// Consolidated test runner — drives every Playwright suite against the running stack
// (real frontend, real user) and reports a pass/fail summary so coverage doesn't regress.
//   node scripts/test_all.mjs            # full suite
//   node scripts/test_all.mjs smoke      # fast core suites only
//   node scripts/test_all.mjs break_it deep_failure   # named subset
import { spawnSync } from "node:child_process";

const API = process.env.API_URL || "http://localhost:8000";
const APP = process.env.APP_URL || "http://localhost:3000";

const SUITES = {
  // core / regression
  poc_e2e:             { group: "core",  desc: "happy-path journey (13 checks)" },
  break_it:            { group: "core",  desc: "adversarial battery (interaction/turn/input/grounding/persistence)" },
  ux_smoke:            { group: "core",  desc: "two-surface UX (dock/workspace/transitions)" },
  capability_test:     { group: "core",  desc: "doc analysis + RAG QA + grounding" },
  // deep / multi-angle
  deep_isolation:      { group: "deep",  desc: "multi-session isolation + concurrency" },
  deep_failure:        { group: "deep",  desc: "failure injection + recovery (no session wipe)" },
  deep_workspace_edges:{ group: "deep",  desc: "deep-link / reload / stop / new-session in workspace" },
  deep_session:        { group: "deep",  desc: "tax-correctness determinism + multiple artifacts" },
  deep_upload:         { group: "deep",  desc: "upload (.md) → grounded analysis" },
  deep_edit:           { group: "deep",  desc: "artifact editing persists (server write)" },
  deep_breadth:        { group: "deep",  desc: "provision / drafting / cross-doc / off-script" },
  deep_pdf:            { group: "deep",  desc: "real PDF → Content Understanding → analysis (env-dependent)" },
};
const SMOKE = ["poc_e2e", "break_it", "ux_smoke", "capability_test"];

const arg = process.argv.slice(2);
let run;
if (arg.length === 0) run = Object.keys(SUITES);
else if (arg.length === 1 && arg[0] === "smoke") run = SMOKE;
else run = arg.filter((a) => SUITES[a]);
if (run.length === 0) { console.error("No matching suites. Known:", Object.keys(SUITES).join(", ")); process.exit(2); }

// stack health pre-check
async function code(url) { try { const r = await fetch(url); return r.status; } catch { return 0; } }
const [s8000, s3000] = await Promise.all([code(`${API}/health`), code(APP)]);
if (s8000 !== 200 || s3000 !== 200) {
  console.error(`✖ Stack not healthy (orchestrator=${s8000} frontend=${s3000}). Start it: uv run python dev.py`);
  process.exit(2);
}
console.log(`Stack healthy. Running ${run.length} suite(s): ${run.join(", ")}\n`);

const results = [];
for (const name of run) {
  console.log(`\n${"=".repeat(70)}\n▶ ${name} — ${SUITES[name].desc}\n${"=".repeat(70)}`);
  const t0 = Date.now();
  const r = spawnSync("node", [`scripts/${name}.mjs`], { stdio: "inherit", env: process.env });
  results.push({ name, code: r.status ?? 1, ms: Date.now() - t0 });
}

console.log(`\n${"#".repeat(70)}\nTEST SUMMARY\n${"#".repeat(70)}`);
let failed = 0;
for (const r of results) {
  const ok = r.code === 0;
  if (!ok) failed++;
  console.log(`${ok ? "✅ PASS" : "❌ FAIL"}  ${r.name.padEnd(22)} (${(r.ms/1000).toFixed(0)}s)${ok?"":`  exit=${r.code}`}`);
}
console.log(`\n${failed === 0 ? "ALL SUITES PASSED" : `${failed} SUITE(S) FAILED`} (${results.length} run)`);
process.exit(failed > 0 ? 1 : 0);
