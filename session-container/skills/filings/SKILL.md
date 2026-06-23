---
name: filings
description: Create, update, and review tax filings (returns, estimated payments, extensions, provisions) and their checklists. Use when the user asks to add/change/list filings or asks what's due or overdue.
---

# Filings

## When to use
Anything about the filings tracker: "create a filing", "add a Q3 estimate",
"mark the 1120 filed", "assign the provision to me", "what's overdue", "list the filings",
"add a step to the California return".

## Tools
- `list_filings()` — every filing with its type, status, due date, assignee, a computed
  `overdue` flag, and checklist progress.
- `create_filing(title, type, due_date, assignee)` — `title` is required; new filings start
  as "Not started" with an empty checklist.
- `update_filing(filing, status, assignee, due_date)` — `filing` is an id or a distinctive
  part of the title.
- `add_checklist_item(filing, text)` — append a step to a filing's checklist.

## Filing types
Common types: "Federal return", "State return", "Estimated payment", "Extension", "Provision".
Use the user's words; default to "Filing" when unclear.

## How to work
- For updates / checklist adds: if the tool returns AMBIGUOUS, list the candidates and ask
  which filing. If it returns FILING_NOT_FOUND, say so — don't invent one.
- For "what's overdue", use the `overdue` flag from `list_filings` and the "[Today: …]"
  context; cite the specific filings. Never judge dates yourself.
- Statuses are "Not started", "In progress", "In review", "Filed". A "Filed" filing is done
  and never overdue.
- Confirm what actually changed, using the tool's returned details. Never claim a filing was
  created or updated unless the tool succeeded.
