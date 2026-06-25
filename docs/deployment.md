# Deployment

Flow deploys to Azure Container Apps: the orchestrator and frontend as Container Apps, and the agent
as a **custom-container session pool** (one isolated container per user). The runnable source of
truth is [`infra/deploy.sh`](../infra/deploy.sh) — this page explains its shape and the two failure
modes that have bitten us.

## What gets provisioned

[`infra/deploy.sh`](../infra/deploy.sh) provisions everything from scratch and is parameterised by a
`PREFIX` environment variable (override it to name your own resources). It creates:

- a user-assigned **managed identity**, an **Azure Container Registry**, and an **ACA environment**;
- the **session pool** (custom container image, `--max-sessions 20`, `--cooldown-period 300`,
  configurable `ready-sessions`, API version `2024-10-02-preview`);
- the **orchestrator** and **frontend** Container Apps (each `0–N` replicas);
- the **role assignments** below.

App-state (Cosmos), the Library index (Azure AI Search), upload originals (ADLS), Content
Understanding, and reminder email (ACS) are expected to exist or be configured via environment
variables — see [`.env.example`](../.env.example) and [retrieval.md](retrieval.md).

## Build & deploy

Images are built cloud-side with `az acr build` and deployed by **git SHA tag** (see the gotcha
below). Image and resource names derive from a `PREFIX` variable in
[`infra/deploy.sh`](../infra/deploy.sh) — which currently defaults to the legacy `taxagent`, so
override it — and the script is the authoritative source. The essence:

```bash
SHA=$(git rev-parse --short HEAD)
# Image names are <prefix>-session / -orchestrator / -frontend (see PREFIX in infra/deploy.sh)
az acr build --registry <acr> --image <prefix>-session:$SHA      --file session-container/Dockerfile session-container/
az acr build --registry <acr> --image <prefix>-orchestrator:$SHA --file Dockerfile .
az acr build --registry <acr> --image <prefix>-frontend:$SHA     --build-arg NEXT_PUBLIC_API_URL=<orchestrator-url> --file frontend/Dockerfile frontend/

az containerapp sessionpool update --name <pool> --resource-group <rg> --image <acr>/<prefix>-session:$SHA \
  --cooldown-period 300 --max-sessions 20 --env-vars <ALL VARS…>
az containerapp update --name <app>      --resource-group <rg> --image <acr>/<prefix>-orchestrator:$SHA
az containerapp update --name <frontend> --resource-group <rg> --image <acr>/<prefix>-frontend:$SHA
```

A session-pool update reprovisions containers (~2–3 min); the orchestrator/frontend update in ~30s.

## Two gotchas that will silently bite you

1. **Never deploy `:latest`.** `az containerapp … --image repo:latest` is silently broken across all
   ACA services. ACA resolves the tag to a digest at revision-creation time and caches it; if the
   image *string* hasn't changed since the last revision, ACA no-ops — no new revision, no pull, old
   code keeps running. **Always use a changing tag (the git SHA).**
2. **`sessionpool update` without `--env-vars` wipes all environment variables.** Always re-specify
   the complete env-var set when updating the pool. `infra/deploy.sh` holds the authoritative list.

## RBAC

The managed identity needs:

| Role | On | Why |
|---|---|---|
| AcrPull | Container Registry | Pull images |
| Cognitive Services User | Foundry / Azure OpenAI | Model + Content Understanding |
| Cosmos DB Built-in Data Contributor | Cosmos account | App state (AAD-only) |
| Storage Blob Data Contributor | ADLS | Upload originals + converted markdown |
| Search Index Data Reader · Search Service Contributor | Azure AI Search | Provisioned by `deploy.sh` |
| Azure ContainerApps Session Executor | Session pool | Orchestrator calls the pool |
| Email-send role *(granted manually)* | Communication Services | Scheduled-reminder email — **not** in `deploy.sh` |

Two notes: (1) although Search RBAC roles are provisioned, the agent's `search_documents` currently
authenticates with the **admin key** (`AZURE_SEARCH_KEY`), so set it. (2) The ACS email role is a
manual prerequisite — `deploy.sh` does not grant it.

## Auth

Two complementary layers, both optional and configured via [`.env.example`](../.env.example):

- **IP restriction** (`ALLOWED_IP`) locks the Container Apps to a single address.
- **Entra app registrations** (`API_AUTH_REQUIRED`, `ENTRA_*`) require a signed-in user at the API
  and enable browser sign-in. Two registrations are used: a backend/API app and a SPA app for the
  frontend.
