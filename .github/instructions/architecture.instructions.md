---
name: architecture
description: RFP Agent system architecture reference. Use when working on any part of the codebase, debugging cross-tier issues, or understanding how components connect.
---

# RFP Agent Architecture Index

Three-tier system: **Frontend → Orchestrator → Session Container → Azure OpenAI**

The orchestrator never runs the Copilot SDK directly. It proxies SSE streams from isolated session containers to the frontend. Sessions are tracked in-memory only — no persistence layer.

## Sub-skills

| Command | Description |
|---|---|
| `/architecture:overview` | System diagram, tiers, local vs production differences |
| `/architecture:sse-flow` | AG-UI protocol, event types, how events flow end-to-end |
| `/architecture:document-processing` | Upload pipeline, Content Understanding, ADLS |
| `/architecture:knowledge-base` | Foundry IQ / Azure AI Search, setup, MCP integration |
| `/architecture:session-lifecycle` | Session IDs, create/validate/delete, auth token forwarding |
| `/architecture:dev-setup` | Prerequisites, dev commands, env vars, Playwright tests |
| `/architecture:deployment` | Azure resources, ACR build commands, container updates |
