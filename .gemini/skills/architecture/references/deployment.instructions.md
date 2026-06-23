---
name: architecture:deployment
description: Azure deployment resources and commands for the RFP Agent — ACR builds, container updates, session pool config.
---

# Deployment

## Azure Resources

| Resource | Name |
|---|---|
| Resource Group | `taxagent-rg` |
| Container Registry | `taxagentacr.azurecr.io` |
| Orchestrator (ACA) | `taxagent-app` |
| Frontend (ACA) | `taxagent-frontend` |
| Session Pool (ACA) | `taxagent-sessions` (max=20, ready=5, cooldown=300s) |

Easy Auth is disabled; IP restriction is used instead.

## Build (Run in Parallel)

```bash
TAG="deploy-$(date +%Y%m%d-%H%M%S)"

az acr build --registry taxagentacr \
  --image tax-session:latest --image tax-session:$TAG \
  --file session-container/Dockerfile session-container/

az acr build --registry taxagentacr \
  --image tax-orchestrator:latest \
  --file Dockerfile .

az acr build --registry taxagentacr \
  --image tax-frontend:latest \
  --build-arg "NEXT_PUBLIC_API_URL=https://taxagent-app.example-env.eastus2.azurecontainerapps.io" \
  --file frontend/Dockerfile frontend/
```

## Update (Run Sequentially)

```bash
# IMPORTANT: Never use :latest for session pools — ACA caches tag resolution
az containerapp sessionpool update \
  --name taxagent-sessions \
  --resource-group taxagent-rg \
  --image taxagentacr.azurecr.io/tax-session:$TAG \
  --cooldown-period 300 --max-sessions 20 --ready-sessions 5

az containerapp update \
  --name taxagent-app \
  --resource-group taxagent-rg \
  --image taxagentacr.azurecr.io/tax-orchestrator:latest

az containerapp update \
  --name taxagent-frontend \
  --resource-group taxagent-rg \
  --image taxagentacr.azurecr.io/tax-frontend:latest
```

## Full Deployment Script

`infra/deploy.sh` — provisions ACA, ACR, ADLS Gen2, Azure AI Search, and all required Azure resources from scratch. Entra ID app registration is a **manual prerequisite** — pass `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, and `ENTRA_CLIENT_SECRET` to the script to configure Easy Auth using an existing registration.

## Public URLs

- Frontend: `https://taxagent-frontend.example-env.eastus2.azurecontainerapps.io`
- Orchestrator: `https://taxagent-app.example-env.eastus2.azurecontainerapps.io`
