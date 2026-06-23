---
name: research
description: Search the indexed document library (meeting notes, project briefs, references) and answer with grounded, cited passages. Use for "what did I decide about X", "find … in my notes", "search the docs", or any question that needs evidence pulled from across the library.
---

# Research

## When to use
- "What did I decide about the budget / the kickoff / next quarter's goals?"
- "Find where I wrote about X" / "search my notes" / "search the docs".
- Any question whose answer lives somewhere in the document library and you don't
  already know which file holds it.

This is retrieval *across* the library. If the user names a specific document and just
wants it read or summarized, prefer the `documents` skill (`list_documents` →
`read_workspace_file`) instead.

## How to ground an answer
1. Call `search_documents(query)` with the user's question in natural language.
2. It returns the top passages, each prefixed with `source: <filename>`.
3. Answer **only** from the returned passages. Do not add facts, figures, or decisions
   that are not in them.
4. **Cite the source filename(s)** you used, e.g. "according to Q2-Budget-Overview.md, …".
   If the answer draws on more than one passage, cite each source.

## Fail loud — never fabricate
- `NO_RESULTS` → tell the user nothing in the library matched; do not invent an answer.
- `SEARCH_NOT_CONFIGURED` → document search isn't set up (Azure AI Search not configured);
  say so plainly. Do not guess.
- `SEARCH_FAILED` → search couldn't run right now; say so. Do not guess.

## Rules
- Only state what the returned passages actually say.
- Always attribute claims to their source filename.
- Be concise — answer the question, then cite.
