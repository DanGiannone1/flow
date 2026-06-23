---
name: architecture:deployment
description: Azure deployment resources and commands for the RFP Agent — ACR builds, container updates, session pool config.
---

# Deployment

## Azure Resources

| Resource | Name |
|---|---|
| Resource Group | `taxagent-rg` (eastus) |
| Container Registry | `taxagentacr.azurecr.io` (in shared-services-rg) |
| Orchestrator (ACA) | `taxagent-app` |
| Frontend (ACA) | `taxagent-frontend` |
| Session Pool (ACA) | `taxagent-sessions` (max=50, ready=5, cooldown=300s) |
| AI Services | `taxagent-ai` (kind: AIServices, gpt-4.1 + text-embedding-3-small) |
| ADLS | `taxagentadls`, filesystem: `documents` |
| AI Search | `taxagent-srch` |
| Managed Identity | `taxagent-identity` |

Easy Auth is disabled; IP restriction is used instead.

## CRITICAL: Never Use :latest for ACA Deployments

`az containerapp update --image repo:latest` is **silently broken** for all ACA services — not just session pools. ACA resolves the tag to a digest at revision creation time and caches it. If the image string in the command hasn't changed since the last revision, ACA no-ops: no new revision, no image pull, old code keeps running.

**Fix: always use git SHA tags.** A changed image string forces a new revision.

## Build + Deploy (use git SHA)

```bash
SHA=$(git rev-parse --short HEAD)

# Build all three (cloud-side builds)
az acr build --registry taxagentacr \
  --image tax-session:$SHA --image tax-session:latest \
  --file session-container/Dockerfile session-container/

az acr build --registry taxagentacr \
  --image tax-orchestrator:$SHA --image tax-orchestrator:latest \
  --file Dockerfile .

az acr build --registry taxagentacr \
  --image tax-frontend:$SHA --image tax-frontend:latest \
  --build-arg "NEXT_PUBLIC_API_URL=https://taxagent-app.example-env.eastus.azurecontainerapps.io" \
  --file frontend/Dockerfile frontend/

# Deploy using SHA tag — ACA sees a changed string, creates a new revision
az containerapp sessionpool update \
  --name taxagent-sessions --resource-group taxagent-rg \
  --image taxagentacr.azurecr.io/tax-session:$SHA \
  --cooldown-period 300 --max-sessions 50 --ready-sessions 5

az containerapp update \
  --name taxagent-app --resource-group taxagent-rg \
  --image taxagentacr.azurecr.io/tax-orchestrator:$SHA

az containerapp update \
  --name taxagent-frontend --resource-group taxagent-rg \
  --image taxagentacr.azurecr.io/tax-frontend:$SHA
```

Session pool update takes ~2-3 minutes (InProgress → Succeeded) while it reprovisions containers. Orchestrator and frontend update in ~30s.

## CRITICAL: Session Pool Env Var Wipe

`az containerapp sessionpool update` without `--env-vars` **wipes all environment variables**. Always re-specify all env vars when updating the pool. See `infra/deploy.sh` for the full list.

## Full Deployment Script

`infra/deploy.sh` — provisions ACA, ACR, ADLS Gen2, Azure AI Search, and all required Azure resources from scratch. Entra ID app registration is a **manual prerequisite** — pass `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, and `ENTRA_CLIENT_SECRET` to the script to configure Easy Auth using an existing registration.

## Public URLs

- Frontend: `https://taxagent-frontend.example-env.eastus.azurecontainerapps.io`
- Orchestrator: `https://taxagent-app.example-env.eastus.azurecontainerapps.io`
