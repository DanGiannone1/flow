---
name: tasks
description: Create, update, delete, and review to-do tasks and their subtasks. Use when the user asks to add/change/list/remove tasks, mark something done, or asks what's due or overdue.
---

# Tasks

## When to use
Anything about the to-do list: "create a task", "add a high-priority task due Friday",
"mark the planning doc in progress", "what's overdue", "list my tasks", "delete the gym
task", "add a subtask to the design slides".

## Tools
- `list_tasks()` — every task with its status, priority, group, due date, a computed
  `overdue` flag, and subtask progress.
- `create_task(title, status, priority, group, due_date)` — `title` is required; new tasks
  default to status "To do", priority "Medium", group "General", and an empty subtask list.
- `update_task(task, status, priority, group, due_date)` — `task` is an id or a distinctive
  part of the title.
- `delete_task(task)` — remove a task.
- `add_subtask(task, text)` — append a subtask to a task.

## Statuses & priorities
- Statuses are exactly: "To do", "In progress", "Blocked", "Done". A "Done" task is complete
  and never overdue.
- Priorities are exactly: "Low", "Medium", "High".
- Map the user's phrasing to these values (e.g. "in progress" → "In progress", "high pri" → "High").

## How to work
- For updates / deletes / subtask adds: if the tool returns AMBIGUOUS, list the candidates
  and ask which task. If it returns TASK_NOT_FOUND, say so — don't invent one.
- For "what's overdue", use the `overdue` flag from `list_tasks` and the "[Today: …]"
  context; cite the specific tasks. Never judge dates yourself.
- Confirm what actually changed, using the tool's returned details. Never claim a task was
  created, updated, or deleted unless the tool succeeded.
