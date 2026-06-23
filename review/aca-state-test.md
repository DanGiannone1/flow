# ACA dynamic-session sandbox — state storage test (2026-06-17)

**Goal:** validate that the per-session workspace state model works on real **Azure Container Apps
dynamic sessions** (custom-container session pool) — i.e. the production target where each user gets an
ephemeral sandbox.

## Setup
- Built the session-container image (Dockerfile-fixed: includes `taxdb.py`, drops deleted `tools/`)
  → `az acr build` → `taxagentacr.azurecr.io/tax-session:test1`.
- Created session pool `taxworkbench-sessions` in env `taxagent-env`, custom container, target-port
  8080, reusing `taxagent-identity` (AcrPull + Cognitive Services User on `taxagent-ai`), env:
  `AZURE_ENDPOINT`, `AZURE_DEPLOYMENT=gpt-4.1`, `AZURE_CLIENT_ID`.
- Granted the dev user **Azure ContainerApps Session Executor** on the pool; called the pool management
  endpoint directly with a `https://dynamicsessions.io` bearer token (identifier = 16-hex session id),
  exactly as `session_manager` does.

## Results — PASS
1. **State persists across requests in a sandbox.** `POST /session?identifier=S` (201, seeds
   `.taxdb.json`) then a *separate* `GET /app/state?identifier=S` returned the seeded data (3 clients,
   5 tasks). Two independent HTTP requests, same sandbox, file persisted between them.
2. **Agent mutation in-sandbox persists.** `POST /chat/stream` with prompt "Create a Q3 estimated
   payment task in Federal Compliance…" → the agent ran *inside the sandbox*, `create_task` returned
   `ok`, streamed "Created a Q3 estimated payment…". A subsequent `GET /app/state` showed the new
   **"Q3 estimated payment"** row → the write persisted across requests in the sandbox.
3. **Per-identifier isolation.** A different identifier returned a fresh seed (no Q3 task) — sandboxes
   are isolated by session id.

## Key finding (architecture-validating)
The first `/chat/stream` attempt failed with `ManagedIdentityCredential ... no response from the IMDS
endpoint` — **ACA session sandboxes do not expose managed-identity/IMDS to the custom container.** The
turn succeeded once the **Cognitive Services token was forwarded via `X-Cogservices-Token`** — which is
exactly what the orchestrator (`session_manager._get_cogservices_token`) already does. So the proven
token-forwarding design is *required*, not incidental, for ACA. (agent.py uses the forwarded token
first, falling back to `DefaultAzureCredential`/IMDS only when absent.)

## Production note
- `readySessionInstances=0` is rejected by the pool API (min 1) on the tested api-version, so an idle
  warm sandbox carries cost; the test pool was **deleted** after validation. Recreate via the steps
  above (or `infra/deploy.sh`, which provisions the full stack).
- State still lives in the **ephemeral** sandbox: it persists for the live session but is destroyed on
  cooldown. Durable, cross-session storage (Blob/doc-store) remains the deferred longterm choice — but
  the per-session workspace model is now confirmed to work unchanged on ACA.
