#!/usr/bin/env bash
#
# Deploy the RFP Agent to Azure Container Apps with Dynamic Sessions.
#
# Prerequisites:
#   - Azure CLI (az) installed and logged in
#   - Docker (for building images)
#
# Usage:
#   ./infra/deploy.sh                          # uses defaults
#   LOCATION=westus2 ./infra/deploy.sh         # override location
#
# App-level Entra auth is wired through env vars. Create the app registrations
# manually, then pass the values below when deploying:
#
#   ENTRA_TENANT_ID=<tenant>
#   ENTRA_API_CLIENT_ID=<api-app-id>
#   ENTRA_FRONTEND_CLIENT_ID=<spa-app-id>
#   ENTRA_REDIRECT_URI=https://<frontend-url>   # auto-derived if omitted
#
set -euo pipefail

# Unique tag for this deploy — ACA only creates a new revision when the image
# string changes. Using :latest is unreliable because ACA caches the resolved
# digest; a SHA-based tag guarantees a new revision on every deploy.
SHA=$(git rev-parse --short HEAD)

# ── Configuration ─────────────────────────────────────────────────────────
PREFIX="${PREFIX:-taxagent}"
LOCATION="${LOCATION:-eastus}"
RG="${PREFIX}-rg"
IDENTITY_NAME="${PREFIX}-identity"
ACR_NAME="${PREFIX}acr"
ENV_NAME="${PREFIX}-env"
SESSION_POOL_NAME="${PREFIX}-sessions"
APP_NAME="${PREFIX}-app"
FRONTEND_NAME="${PREFIX}-frontend"

AZURE_DEPLOYMENT="${AZURE_DEPLOYMENT:-gpt-4.1}"
COSMOS_ENDPOINT="${COSMOS_ENDPOINT:-}"
ADLS_ACCOUNT_NAME="${ADLS_ACCOUNT_NAME:-${PREFIX}adls}"
ADLS_FILESYSTEM="${ADLS_FILESYSTEM:-documents}"
AZURE_SEARCH_KB_NAME="${AZURE_SEARCH_KB_NAME:-tax-knowledge}"
LOG_ANALYTICS_WORKSPACE_NAME="${LOG_ANALYTICS_WORKSPACE_NAME:-${PREFIX}-logs}"
APPINSIGHTS_NAME="${APPINSIGHTS_NAME:-${PREFIX}-insights}"
APPLICATIONINSIGHTS_CONNECTION_STRING="${APPLICATIONINSIGHTS_CONNECTION_STRING:-}"
OTEL_SERVICE_NAME="${OTEL_SERVICE_NAME:-flow-session}"
OTEL_SERVICE_NAMESPACE="${OTEL_SERVICE_NAMESPACE:-flow}"
OTEL_SERVICE_VERSION="${OTEL_SERVICE_VERSION:-$SHA}"
OTEL_DEPLOYMENT_ENVIRONMENT="${OTEL_DEPLOYMENT_ENVIRONMENT:-azure}"
SESSION_READY_SESSIONS="${SESSION_READY_SESSIONS:-0}"
ORCHESTRATOR_MIN_REPLICAS="${ORCHESTRATOR_MIN_REPLICAS:-0}"
FRONTEND_MIN_REPLICAS="${FRONTEND_MIN_REPLICAS:-0}"
SESSION_POOL_API_VERSION="${SESSION_POOL_API_VERSION:-2024-10-02-preview}"

# Optional: restrict ingress to a specific IP (e.g. your office/home IP).
# Leave blank to allow all traffic.
ALLOWED_IP="${ALLOWED_IP:-}"
ALLOW_PUBLIC_UNAUTHENTICATED="${ALLOW_PUBLIC_UNAUTHENTICATED:-false}"

# Optional: App-level auth and ACA Easy Auth.
# ENTRA_CLIENT_SECRET comes from the backend app registration's client credentials
# and is only required for the ACA Easy Auth step below.
API_AUTH_REQUIRED="${API_AUTH_REQUIRED:-false}"
API_KEY="${API_KEY:-${LOCAL_API_KEY:-}}"
ENTRA_TENANT_ID="${ENTRA_TENANT_ID:-}"
ENTRA_API_CLIENT_ID="${ENTRA_API_CLIENT_ID:-${ENTRA_CLIENT_ID:-}}"
ENTRA_FRONTEND_CLIENT_ID="${ENTRA_FRONTEND_CLIENT_ID:-}"
ENTRA_API_SCOPES="${ENTRA_API_SCOPES:-}"
ENTRA_ALLOWED_AUDIENCES="${ENTRA_ALLOWED_AUDIENCES:-${ENTRA_API_AUDIENCES:-}}"
ENTRA_CLIENT_ID="${ENTRA_CLIENT_ID:-$ENTRA_API_CLIENT_ID}"
ENTRA_CLIENT_SECRET="${ENTRA_CLIENT_SECRET:-}"
ENTRA_REDIRECT_URI="${ENTRA_REDIRECT_URI:-}"  # auto-derived from frontend URL if blank

is_truthy() {
    case "${1,,}" in
        1|true|yes|on) return 0 ;;
        *) return 1 ;;
    esac
}

if ! is_truthy "$API_AUTH_REQUIRED" && [ -z "$ALLOWED_IP" ] && ! is_truthy "$ALLOW_PUBLIC_UNAUTHENTICATED"; then
    echo "ERROR: Refusing to deploy public unauthenticated ingress."
    echo "Set API_AUTH_REQUIRED=true, set ALLOWED_IP, or explicitly set ALLOW_PUBLIC_UNAUTHENTICATED=true."
    exit 1
fi

echo "=== RFP Agent Deployment ==="
echo "Resource Group:  $RG"
echo "Location:        $LOCATION"
echo "ACR:             $ACR_NAME"
echo "Session Pool:    $SESSION_POOL_NAME"
echo "App:             $APP_NAME"
echo "API Auth:        $API_AUTH_REQUIRED"
if [ -n "$APPLICATIONINSIGHTS_CONNECTION_STRING" ]; then
    echo "Tracing:         enabled"
else
    echo "Tracing:         provision App Insights"
fi
echo ""

# ── 1. Resource Group ────────────────────────────────────────────────────
echo ">>> Creating resource group..."
az group create --name "$RG" --location "$LOCATION" -o none

# ── 1b. Observability (Application Insights + Log Analytics) ───────────────
echo ">>> Ensuring Log Analytics workspace..."
az monitor log-analytics workspace create \
    --resource-group "$RG" \
    --workspace-name "$LOG_ANALYTICS_WORKSPACE_NAME" \
    --location "$LOCATION" \
    -o none

LOG_ANALYTICS_WORKSPACE_ID=$(az monitor log-analytics workspace show \
    --resource-group "$RG" \
    --workspace-name "$LOG_ANALYTICS_WORKSPACE_NAME" \
    --query id -o tsv)

LOG_ANALYTICS_SHARED_KEY=$(az monitor log-analytics workspace get-shared-keys \
    --resource-group "$RG" \
    --workspace-name "$LOG_ANALYTICS_WORKSPACE_NAME" \
    --query primarySharedKey -o tsv)

if [ -z "$APPLICATIONINSIGHTS_CONNECTION_STRING" ]; then
    echo ">>> Ensuring Application Insights CLI extension is installed..."
    az extension add --name application-insights --upgrade -y >/dev/null

    if ! az monitor app-insights component show \
        --app "$APPINSIGHTS_NAME" \
        --resource-group "$RG" \
        -o none >/dev/null 2>&1; then
        echo ">>> Creating Application Insights resource..."
        az monitor app-insights component create \
            --app "$APPINSIGHTS_NAME" \
            --resource-group "$RG" \
            --location "$LOCATION" \
            --workspace "$LOG_ANALYTICS_WORKSPACE_ID" \
            -o none
    else
        echo ">>> Reusing existing Application Insights resource..."
    fi

    APPLICATIONINSIGHTS_CONNECTION_STRING=$(az monitor app-insights component show \
        --app "$APPINSIGHTS_NAME" \
        --resource-group "$RG" \
        --query connectionString -o tsv)

    if [ -z "$APPLICATIONINSIGHTS_CONNECTION_STRING" ]; then
        echo "ERROR: Failed to provision Application Insights or retrieve its connection string."
        exit 1
    fi
fi

if [ -n "$APPLICATIONINSIGHTS_CONNECTION_STRING" ]; then
    echo "    App Insights: $APPINSIGHTS_NAME"
fi

# ── 2. User-Assigned Managed Identity ────────────────────────────────────
echo ">>> Creating managed identity..."
az identity create --name "$IDENTITY_NAME" --resource-group "$RG" -o none

IDENTITY_ID=$(az identity show --name "$IDENTITY_NAME" --resource-group "$RG" --query id -o tsv)
IDENTITY_CLIENT_ID=$(az identity show --name "$IDENTITY_NAME" --resource-group "$RG" --query clientId -o tsv)
IDENTITY_PRINCIPAL_ID=$(az identity show --name "$IDENTITY_NAME" --resource-group "$RG" --query principalId -o tsv)

echo "    Identity Client ID: $IDENTITY_CLIENT_ID"

# ── 3. Azure Container Registry ─────────────────────────────────────────
echo ">>> Creating container registry..."
az acr create --name "$ACR_NAME" --resource-group "$RG" --sku Basic --admin-enabled false -o none

ACR_LOGIN_SERVER=$(az acr show --name "$ACR_NAME" --resource-group "$RG" --query loginServer -o tsv)
echo "    ACR Login Server: $ACR_LOGIN_SERVER"

# Grant AcrPull to the managed identity
echo ">>> Granting AcrPull to managed identity..."
ACR_ID=$(az acr show --name "$ACR_NAME" --resource-group "$RG" --query id -o tsv)
az role assignment create \
    --assignee-object-id "$IDENTITY_PRINCIPAL_ID" \
    --assignee-principal-type ServicePrincipal \
    --role AcrPull \
    --scope "$ACR_ID" \
    -o none

# ── 4. Cognitive Services role (Azure OpenAI + Content Understanding) ────
AZURE_ENDPOINT="${AZURE_ENDPOINT:-}"
if [ -z "$AZURE_ENDPOINT" ]; then
    echo "ERROR: AZURE_ENDPOINT must be set"
    exit 1
fi

# Cognitive Services User covers both OpenAI and Content Understanding
echo ">>> Granting Cognitive Services User to managed identity..."
AOAI_RESOURCE_NAME=$(echo "$AZURE_ENDPOINT" | sed -n 's|https://\(.*\)\.cognitiveservices.*|\1|p')
if [ -z "$AOAI_RESOURCE_NAME" ]; then
    # Try Foundry-style endpoint: https://name.services.ai.azure.com/
    AOAI_RESOURCE_NAME=$(echo "$AZURE_ENDPOINT" | sed -n 's|https://\(.*\)\.services\.ai\.azure\.com.*|\1|p')
fi
if [ -n "$AOAI_RESOURCE_NAME" ]; then
    AOAI_ID=$(az cognitiveservices account list --resource-group "$RG" \
        --query "[?name=='$AOAI_RESOURCE_NAME'].id" -o tsv 2>/dev/null || true)
    if [ -z "$AOAI_ID" ]; then
        echo "    Note: Cognitive Services resource not found in $RG. Assigning at subscription scope."
        az role assignment create \
            --assignee-object-id "$IDENTITY_PRINCIPAL_ID" \
            --assignee-principal-type ServicePrincipal \
            --role "Cognitive Services User" \
            --scope "/subscriptions/$(az account show --query id -o tsv)" \
            -o none
    else
        az role assignment create \
            --assignee-object-id "$IDENTITY_PRINCIPAL_ID" \
            --assignee-principal-type ServicePrincipal \
            --role "Cognitive Services User" \
            --scope "$AOAI_ID" \
            -o none
    fi
else
    echo "ERROR: Could not parse Cognitive Services resource name from AZURE_ENDPOINT=$AZURE_ENDPOINT"
    exit 1
fi

# ── 4b. ADLS Gen2 Storage ────────────────────────────────────────────────
echo ">>> Creating ADLS Gen2 storage account..."
az storage account create \
    --name "$ADLS_ACCOUNT_NAME" \
    --resource-group "$RG" \
    --location "$LOCATION" \
    --sku Standard_LRS \
    --kind StorageV2 \
    --hns true \
    -o none

echo ">>> Ensuring ADLS public network access is enabled..."
az storage account update \
    --name "$ADLS_ACCOUNT_NAME" \
    --resource-group "$RG" \
    --public-network-access Enabled \
    -o none

echo ">>> Creating ADLS filesystem..."
az storage fs create \
    --name "$ADLS_FILESYSTEM" \
    --account-name "$ADLS_ACCOUNT_NAME" \
    --auth-mode login \
    -o none 2>/dev/null || true  # ignore "already exists"

echo ">>> Granting Storage Blob Data Contributor to managed identity on ADLS..."
ADLS_ID=$(az storage account show --name "$ADLS_ACCOUNT_NAME" --resource-group "$RG" --query id -o tsv)
az role assignment create \
    --assignee-object-id "$IDENTITY_PRINCIPAL_ID" \
    --assignee-principal-type ServicePrincipal \
    --role "Storage Blob Data Contributor" \
    --scope "$ADLS_ID" \
    -o none

# ── 4c. Azure AI Search (Foundry IQ agentic retrieval) ────────────────
SEARCH_NAME="${PREFIX}-srch"
echo ">>> Creating Azure AI Search service..."
az search service create \
    --name "$SEARCH_NAME" \
    --resource-group "$RG" \
    --location "$LOCATION" \
    --sku basic \
    --partition-count 1 \
    --replica-count 1 \
    -o none

SEARCH_ENDPOINT="https://${SEARCH_NAME}.search.windows.net"
echo "    Search endpoint: $SEARCH_ENDPOINT"

# Grant Search roles to the managed identity
echo ">>> Granting Search roles to managed identity..."
SEARCH_ID=$(az search service show --name "$SEARCH_NAME" --resource-group "$RG" --query id -o tsv)
az role assignment create \
    --assignee-object-id "$IDENTITY_PRINCIPAL_ID" \
    --assignee-principal-type ServicePrincipal \
    --role "Search Index Data Reader" \
    --scope "$SEARCH_ID" \
    -o none
az role assignment create \
    --assignee-object-id "$IDENTITY_PRINCIPAL_ID" \
    --assignee-principal-type ServicePrincipal \
    --role "Search Service Contributor" \
    --scope "$SEARCH_ID" \
    -o none

# ── 5. Container Apps Environment ────────────────────────────────────────
if az containerapp env show \
    --name "$ENV_NAME" \
    --resource-group "$RG" \
    -o none >/dev/null 2>&1; then
    echo ">>> Reusing Container Apps environment..."
else
    echo ">>> Creating Container Apps environment..."
    az containerapp env create \
        --name "$ENV_NAME" \
        --resource-group "$RG" \
        --location "$LOCATION" \
        --logs-workspace-id "$LOG_ANALYTICS_WORKSPACE_ID" \
        --logs-workspace-key "$LOG_ANALYTICS_SHARED_KEY" \
        -o none
fi

# ── 6. Build & Push Session Container Image ─────────────────────────────
echo ">>> Building session container image..."
SESSION_IMAGE="$ACR_LOGIN_SERVER/tax-session:$SHA"
az acr build \
    --registry "$ACR_NAME" \
    --image "tax-session:$SHA" \
    --image "tax-session:latest" \
    --file session-container/Dockerfile \
    session-container/ \
    -o none

# ── 7. Create Session Pool (Custom Container) ───────────────────────────
echo ">>> Creating session pool..."

# Get the environment ID
ENV_ID=$(az containerapp env show --name "$ENV_NAME" --resource-group "$RG" --query id -o tsv)

if ! az containerapp sessionpool create \
    --name "$SESSION_POOL_NAME" \
    --resource-group "$RG" \
    --location "$LOCATION" \
    --environment "$ENV_ID" \
    --container-type CustomContainer \
    --image "$SESSION_IMAGE" \
    --registry-server "$ACR_LOGIN_SERVER" \
    --registry-identity "$IDENTITY_ID" \
    --target-port 8080 \
    --cooldown-period 300 \
    --network-status EgressEnabled \
    --max-sessions 20 \
    --ready-sessions "$SESSION_READY_SESSIONS" \
    --cpu 1.0 --memory 2Gi \
    --env-vars \
        "AZURE_ENDPOINT=$AZURE_ENDPOINT" \
        "AZURE_DEPLOYMENT=$AZURE_DEPLOYMENT" \
        "AZURE_SEARCH_ENDPOINT=$SEARCH_ENDPOINT" \
        "AZURE_SEARCH_KB_NAME=$AZURE_SEARCH_KB_NAME" \
        "ADLS_ACCOUNT_NAME=$ADLS_ACCOUNT_NAME" \
        "ADLS_FILESYSTEM=$ADLS_FILESYSTEM" \
        "AZURE_CLIENT_ID=$IDENTITY_CLIENT_ID" \
        "APPLICATIONINSIGHTS_CONNECTION_STRING=$APPLICATIONINSIGHTS_CONNECTION_STRING" \
        "OTEL_SERVICE_NAME=$OTEL_SERVICE_NAME" \
        "OTEL_SERVICE_NAMESPACE=$OTEL_SERVICE_NAMESPACE" \
        "OTEL_SERVICE_VERSION=$OTEL_SERVICE_VERSION" \
        "OTEL_DEPLOYMENT_ENVIRONMENT=$OTEL_DEPLOYMENT_ENVIRONMENT" \
    -o none 2>/dev/null; then
    echo "    Session pool exists, updating..."
    az containerapp sessionpool update \
        --name "$SESSION_POOL_NAME" \
        --resource-group "$RG" \
        --image "$SESSION_IMAGE" \
        --cooldown-period 300 \
        --max-sessions 20 \
        --ready-sessions "$SESSION_READY_SESSIONS" \
        --env-vars \
            "AZURE_ENDPOINT=$AZURE_ENDPOINT" \
            "AZURE_DEPLOYMENT=$AZURE_DEPLOYMENT" \
            "AZURE_SEARCH_ENDPOINT=$SEARCH_ENDPOINT" \
            "AZURE_SEARCH_KB_NAME=$AZURE_SEARCH_KB_NAME" \
            "ADLS_ACCOUNT_NAME=$ADLS_ACCOUNT_NAME" \
            "ADLS_FILESYSTEM=$ADLS_FILESYSTEM" \
            "AZURE_CLIENT_ID=$IDENTITY_CLIENT_ID" \
            "APPLICATIONINSIGHTS_CONNECTION_STRING=$APPLICATIONINSIGHTS_CONNECTION_STRING" \
            "OTEL_SERVICE_NAME=$OTEL_SERVICE_NAME" \
            "OTEL_SERVICE_NAMESPACE=$OTEL_SERVICE_NAMESPACE" \
            "OTEL_SERVICE_VERSION=$OTEL_SERVICE_VERSION" \
            "OTEL_DEPLOYMENT_ENVIRONMENT=$OTEL_DEPLOYMENT_ENVIRONMENT" \
        -o none
fi

POOL_ID=$(az containerapp sessionpool show \
    --name "$SESSION_POOL_NAME" \
    --resource-group "$RG" \
    --query id -o tsv)

# The containerapp extension has failed to apply --ready-sessions 0 in practice.
# Reassert through the ARM resource API and fail loudly if Azure keeps warm sessions.
az resource update \
    --ids "$POOL_ID" \
    --api-version "$SESSION_POOL_API_VERSION" \
    --set "properties.scaleConfiguration.readySessionInstances=$SESSION_READY_SESSIONS" \
    -o none

ACTUAL_READY_SESSIONS=$(az containerapp sessionpool show \
    --name "$SESSION_POOL_NAME" \
    --resource-group "$RG" \
    --query "properties.scaleConfiguration.readySessionInstances" -o tsv)

if [ "$ACTUAL_READY_SESSIONS" != "$SESSION_READY_SESSIONS" ]; then
    echo "ERROR: Session pool ready sessions is $ACTUAL_READY_SESSIONS, expected $SESSION_READY_SESSIONS."
    exit 1
fi

POOL_ENDPOINT=$(az containerapp sessionpool show \
    --name "$SESSION_POOL_NAME" \
    --resource-group "$RG" \
    --query "properties.poolManagementEndpoint" -o tsv)

echo "    Pool Management Endpoint: $POOL_ENDPOINT"

# ── 8. Session Executor role (needed by orchestrator to call session pool) ─
echo ">>> Granting Session Executor to managed identity..."
az role assignment create \
    --assignee-object-id "$IDENTITY_PRINCIPAL_ID" \
    --assignee-principal-type ServicePrincipal \
    --role "Azure ContainerApps Session Executor" \
    --scope "$POOL_ID" \
    -o none

# ── 9. Build & Push Orchestrator Image ───────────────────────────────────
echo ">>> Building orchestrator image..."
az acr build \
    --registry "$ACR_NAME" \
    --image "tax-orchestrator:$SHA" \
    --image "tax-orchestrator:latest" \
    --file Dockerfile \
    . \
    -o none

# ── 10. Deploy Orchestrator as Container App ─────────────────────────────
echo ">>> Deploying orchestrator container app..."
ORCHESTRATOR_IMAGE="$ACR_LOGIN_SERVER/tax-orchestrator:$SHA"

ORCHESTRATOR_ENV_VARS=(
    "POOL_MANAGEMENT_ENDPOINT=$POOL_ENDPOINT"
    "COSMOS_ENDPOINT=$COSMOS_ENDPOINT"
    "AZURE_ENDPOINT=$AZURE_ENDPOINT"
    "ADLS_ACCOUNT_NAME=$ADLS_ACCOUNT_NAME"
    "ADLS_FILESYSTEM=$ADLS_FILESYSTEM"
    "AZURE_CLIENT_ID=$IDENTITY_CLIENT_ID"
    "API_AUTH_REQUIRED=$API_AUTH_REQUIRED"
)

if [ -n "$ENTRA_TENANT_ID" ]; then
    ORCHESTRATOR_ENV_VARS+=("ENTRA_TENANT_ID=$ENTRA_TENANT_ID")
fi
if [ -n "$ENTRA_API_CLIENT_ID" ]; then
    ORCHESTRATOR_ENV_VARS+=("ENTRA_API_CLIENT_ID=$ENTRA_API_CLIENT_ID")
fi
if [ -n "$ENTRA_ALLOWED_AUDIENCES" ]; then
    ORCHESTRATOR_ENV_VARS+=("ENTRA_ALLOWED_AUDIENCES=$ENTRA_ALLOWED_AUDIENCES")
fi

if ! az containerapp create \
    --name "$APP_NAME" \
    --resource-group "$RG" \
    --environment "$ENV_NAME" \
    --image "$ORCHESTRATOR_IMAGE" \
    --registry-server "$ACR_LOGIN_SERVER" \
    --registry-identity "$IDENTITY_ID" \
    --user-assigned "$IDENTITY_ID" \
    --target-port 8000 \
    --ingress external \
    --min-replicas "$ORCHESTRATOR_MIN_REPLICAS" \
    --max-replicas 3 \
    --env-vars \
        "${ORCHESTRATOR_ENV_VARS[@]}" \
    -o none 2>/dev/null; then
    echo "    Orchestrator app exists, updating..."
    az containerapp update \
        --name "$APP_NAME" \
        --resource-group "$RG" \
        --image "$ORCHESTRATOR_IMAGE" \
        --min-replicas "$ORCHESTRATOR_MIN_REPLICAS" \
        --max-replicas 3 \
        --set-env-vars \
            "${ORCHESTRATOR_ENV_VARS[@]}" \
        -o none
fi

if [ -n "$API_KEY" ]; then
    echo ">>> Setting orchestrator API key secret..."
    az containerapp secret set \
        --name "$APP_NAME" \
        --resource-group "$RG" \
        --secrets "api-key=$API_KEY" \
        -o none
    az containerapp update \
        --name "$APP_NAME" \
        --resource-group "$RG" \
        --set-env-vars "API_KEY=secretref:api-key" \
        -o none
fi

APP_URL=$(az containerapp show \
    --name "$APP_NAME" \
    --resource-group "$RG" \
    --query "properties.configuration.ingress.fqdn" -o tsv)

echo "    App URL: https://$APP_URL"

# ── 11. Easy Auth (optional) ─────────────────────────────────────────────
# Requires ENTRA_TENANT_ID, ENTRA_API_CLIENT_ID, and ENTRA_CLIENT_SECRET to be set.
# The app registration itself must be created manually — this step only
# configures Easy Auth on the container app using the existing registration.
if [ -n "$ENTRA_TENANT_ID" ] && [ -n "$ENTRA_API_CLIENT_ID" ] && [ -n "$ENTRA_CLIENT_SECRET" ]; then
    echo ">>> Configuring Easy Auth on orchestrator..."
    # Store the client secret in the container app's secret store so it is
    # never passed as a CLI flag (which would expose it in process listings).
    az containerapp secret set \
        --name "$APP_NAME" --resource-group "$RG" \
        --secrets "entra-client-secret=$ENTRA_CLIENT_SECRET" \
        -o none
    az containerapp auth microsoft update \
        --name "$APP_NAME" --resource-group "$RG" \
        --client-id "$ENTRA_API_CLIENT_ID" \
        --client-secret-setting-name "entra-client-secret" \
        --issuer "https://login.microsoftonline.com/$ENTRA_TENANT_ID/v2.0" \
        --yes \
        -o none
    az containerapp auth update \
        --name "$APP_NAME" --resource-group "$RG" \
        --unauthenticated-client-action Return401 \
        -o none
    echo "    Easy Auth enabled."
else
    echo ">>> Skipping Easy Auth (ENTRA_TENANT_ID / ENTRA_API_CLIENT_ID / ENTRA_CLIENT_SECRET not set)."
fi

# ── 12. Build & Push Frontend Image ─────────────────────────────────────
echo ">>> Building frontend image..."
FRONTEND_IMAGE="$ACR_LOGIN_SERVER/tax-frontend:$SHA"

# Derive redirect URI from frontend URL if not explicitly provided
FRONTEND_URL_PREVIEW="${FRONTEND_NAME}.$(az containerapp env show --name "$ENV_NAME" --resource-group "$RG" --query "properties.defaultDomain" -o tsv)"
RESOLVED_REDIRECT_URI="${ENTRA_REDIRECT_URI:-https://$FRONTEND_URL_PREVIEW}"

az acr build \
    --registry "$ACR_NAME" \
    --image "tax-frontend:$SHA" \
    --image "tax-frontend:latest" \
    --file frontend/Dockerfile \
    --build-arg "NEXT_PUBLIC_API_URL=https://$APP_URL" \
    --build-arg "NEXT_PUBLIC_AUTH_ENABLED=${API_AUTH_REQUIRED}" \
    --build-arg "NEXT_PUBLIC_ENTRA_TENANT_ID=${ENTRA_TENANT_ID}" \
    --build-arg "NEXT_PUBLIC_ENTRA_CLIENT_ID=${ENTRA_FRONTEND_CLIENT_ID}" \
    --build-arg "NEXT_PUBLIC_ENTRA_API_CLIENT_ID=${ENTRA_API_CLIENT_ID}" \
    --build-arg "NEXT_PUBLIC_ENTRA_API_SCOPES=${ENTRA_API_SCOPES}" \
    --build-arg "NEXT_PUBLIC_ENTRA_REDIRECT_URI=${RESOLVED_REDIRECT_URI}" \
    frontend/ \
    -o none

# ── 13. Deploy Frontend as Container App ────────────────────────────────
echo ">>> Deploying frontend container app..."

if ! az containerapp create \
    --name "$FRONTEND_NAME" \
    --resource-group "$RG" \
    --environment "$ENV_NAME" \
    --image "$FRONTEND_IMAGE" \
    --registry-server "$ACR_LOGIN_SERVER" \
    --registry-identity "$IDENTITY_ID" \
    --target-port 3000 \
    --ingress external \
    --min-replicas "$FRONTEND_MIN_REPLICAS" \
    --max-replicas 3 \
    --cpu 0.25 --memory 0.5Gi \
    -o none 2>/dev/null; then
    echo "    Frontend app exists, updating..."
    az containerapp update \
        --name "$FRONTEND_NAME" \
        --resource-group "$RG" \
        --image "$FRONTEND_IMAGE" \
        --min-replicas "$FRONTEND_MIN_REPLICAS" \
        --max-replicas 3 \
        -o none
fi

FRONTEND_URL=$(az containerapp show \
    --name "$FRONTEND_NAME" \
    --resource-group "$RG" \
    --query "properties.configuration.ingress.fqdn" -o tsv)

echo "    Frontend URL: https://$FRONTEND_URL"

# ── 14. Update orchestrator CORS with frontend URL ─────────────────────
echo ">>> Updating orchestrator CORS..."
az containerapp update \
    --name "$APP_NAME" \
    --resource-group "$RG" \
    --set-env-vars "FRONTEND_URL=https://$FRONTEND_URL" \
    -o none

# CORS at the ingress level runs before Easy Auth, so preflight (OPTIONS)
# passes through without a token.
echo ">>> Enabling ingress CORS..."
az containerapp ingress cors enable \
    --name "$APP_NAME" --resource-group "$RG" \
    --allowed-origins "https://$FRONTEND_URL" "http://localhost:3000" \
    --allowed-methods "*" \
    --allowed-headers "Authorization" "Content-Type" \
    --allow-credentials true \
    -o none

# ── 15. IP Restrictions ──────────────────────────────────────────────────
if [ -n "$ALLOWED_IP" ]; then
    echo ">>> Restricting ingress to $ALLOWED_IP..."
    az containerapp ingress access-restriction set \
        --name "$APP_NAME" --resource-group "$RG" \
        --rule-name "allow-my-ip" \
        --ip-address "$ALLOWED_IP" \
        --action Allow \
        -o none
    az containerapp ingress access-restriction set \
        --name "$FRONTEND_NAME" --resource-group "$RG" \
        --rule-name "allow-my-ip" \
        --ip-address "$ALLOWED_IP" \
        --action Allow \
        -o none
    echo "    IP restriction set."
else
    echo ">>> Skipping IP restriction (ALLOWED_IP not set)."
fi

# ── 16. Summary ─────────────────────────────────────────────────────────
echo ""
echo "=== Deployment Complete ==="
echo ""
echo "Frontend URL:             https://$FRONTEND_URL"
echo "Orchestrator URL:         https://$APP_URL"
echo "Pool Management Endpoint: $POOL_ENDPOINT"
echo "Managed Identity:         $IDENTITY_CLIENT_ID"
if [ -n "$APPLICATIONINSIGHTS_CONNECTION_STRING" ]; then
echo "Application Insights:     $APPINSIGHTS_NAME"
echo "Log Analytics workspace:  $LOG_ANALYTICS_WORKSPACE_NAME"
fi
echo ""
echo "AI Search (knowledge base):"
echo "  Endpoint:               $SEARCH_ENDPOINT"
echo "  KB Name:                $AZURE_SEARCH_KB_NAME"
echo ""
if [ -n "$ENTRA_TENANT_ID" ]; then
echo "Entra ID (auth):"
echo "  Tenant ID:              $ENTRA_TENANT_ID"
echo "  API Client ID:          $ENTRA_API_CLIENT_ID"
echo "  Frontend Client ID:     $ENTRA_FRONTEND_CLIENT_ID"
echo "  Redirect URI:           $RESOLVED_REDIRECT_URI"
else
echo "Entra ID: not configured (pass ENTRA_TENANT_ID / ENTRA_API_CLIENT_ID / ENTRA_FRONTEND_CLIENT_ID to enable)"
fi
echo ""
echo "Foundry tracing note: connect the Application Insights resource to your Foundry project"
echo "from Foundry portal -> Observability/Tracing before expecting traces in Foundry."
echo ""
echo "Next step: run 'uv run python setup_knowledge_base.py' to create the knowledge base."
echo ""
