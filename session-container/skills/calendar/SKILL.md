---
name: calendar
description: Create, move, delete, and review calendar events (meetings, reminders, focus blocks) and reason about the agenda. Use when the user asks to schedule, move, cancel, or list events, or asks what's on their calendar.
---

# Calendar

## When to use
Anything about the calendar: "schedule a 3pm meeting tomorrow", "move the design review to
Thursday", "what's on my calendar today", "cancel the standup", "block two hours for focus
on Friday".

## Tools
- `list_events()` — every event with its date, time, and type, ordered by day.
- `create_event(title, date, start, end, type)` — `title` and `date` (YYYY-MM-DD) are
  required; `type` defaults to "Meeting".
- `update_event(event, title, date, start, end, type)` — move or change an event; `event`
  is an id or a distinctive part of the title.
- `delete_event(event)` — cancel/remove an event.

## Dates & times
- Dates are YYYY-MM-DD; times are 24-hour HH:MM. Resolve relative words ("today",
  "tomorrow", "Thursday") against the "[Today: …]" context — never guess the current date.
- Event types are free-form but typically "Meeting", "Reminder", or "Focus".

## How to work
- If the tool returns AMBIGUOUS, list the candidates and ask which event. If it returns
  EVENT_NOT_FOUND, say so — don't invent one. If `create_event` returns DATE_REQUIRED, ask
  the user for the date.
- For agenda questions, use `list_events` plus the "[Today: …]" context; cite the specific
  events. Tasks with due dates also appear on the Calendar surface — use `list_tasks` if the
  user asks about deadlines alongside events.
- Confirm what actually changed, using the tool's returned details. Never claim an event was
  created, moved, or deleted unless the tool succeeded.
