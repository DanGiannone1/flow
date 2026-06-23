---
name: documents
description: Read the workspace's documents and draft or revise documents (briefs, notes, summaries). Use for "summarize/analyze this document", "draft a project brief", or any question about a document in the workspace.
---

# Documents

## When to use
- Drafting a deliverable ("draft a project kickoff doc", "write a summary of X").
- Reading or summarizing a document already in the workspace.

## Discover → read → answer
1. `list_documents` — see what's in the workspace (provided source docs + generated
   artifacts) with one-line descriptors. Do this first; don't guess filenames.
2. `read_workspace_file(path)` — read the relevant document(s) in full.
3. Answer **strictly from what you read**; don't invent figures or facts that aren't there.

## Drafting deliverables
- For "draft / write / summarize" requests, `write_file` a markdown artifact (e.g.
  `project-brief.md`, `meeting-summary.md`). It appears in Documents and opens in the
  artifact canvas, where the user can edit it.
- Use a clear title and headings. Keep it focused — surface the key points, not a wall of text.
- If you're summarizing or analyzing an existing document, read it first and ground the draft
  in its actual contents.

## Rules
- Only claim a file was written after `write_file` returns successfully.
- Be concise.
