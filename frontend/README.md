# RFP Agent — Frontend

Next.js 16 web UI for the RFP Agent. Communicates with the orchestrator over HTTP and SSE.

## Development

```bash
npm install
npm run dev      # http://localhost:3000
npm run build
npm run lint
```

The frontend expects the orchestrator at `http://localhost:8000` by default. Override with:

```bash
NEXT_PUBLIC_API_URL=https://your-orchestrator.azurecontainerapps.io npm run dev
```

## Structure

```
src/
  app/          Next.js App Router pages and layout
  components/   UI components (Chat, IntakeScreen, MessageBubble, ToolIndicator, ...)
  lib/          API client, session management, shared types
public/
  icon.svg      App icon
```

## Running the full stack

From the repo root:

```bash
uv run dev.py   # starts session container (:8080), orchestrator (:8000), and frontend (:3000)
```

See the root [README](../README.md) for full setup and deployment instructions.
