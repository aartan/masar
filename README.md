# Masar

Masar is a project management app for organising projects, managing tasks and tracking progress. Create boards, organise columns, set priorities and due dates, manage subtasks and comments, and monitor upcoming work from your dashboard

## Overview dashboard

![Masar overview dashboard](docs/assets/overview.png)

The overview brings the workspace together: open tasks, due dates, recent completions, progress by board, workload by priority and the newest work in one place.

## Features

- **Boards and columns** — Create boards with five starter columns, then add, rename, reorder or delete columns to match your workflow. Reorder boards in the sidebar and mark the columns that count as done.
- **Task management** — Capture descriptions, priorities, due dates and labels. Break work into subtasks, discuss it in comments, and duplicate or delete tasks when plans change.
- **Board and list views** — Work visually on the Kanban board or switch to a compact list. Both views open the same task details and support the same filters.
- **Search and filters** — Filter a board by priority, label, due date or status, and sort by manual order, due date, priority or newest. Use `Cmd/Ctrl+K` to search tasks and jump to any board.
- **Calendar planning** — Plan scheduled work in month, week and day views. Drag tasks onto a date, or move them back to Unscheduled to clear the due date.
- **Overview dashboard** — Review open tasks, due dates, recent completions, progress by board, workload by priority and recently added work.
- **Local-first by default** — No account is needed. Boards and tasks live in a local SQLite database and remain available offline.
- **Optional cloud sync** — Sign in from Account settings to use a separate synced workspace. Changes sync in the background while your subscription is active; local data is only uploaded when you choose to import it.
- **Desktop polish** — Light, dark and system themes, responsive layouts, mouse and keyboard drag-and-drop, and a clear offline indicator.
- **Keyboard shortcuts** — Press `N` on a board to create a task, `?` for the shortcut guide, and `Cmd/Ctrl+K` for search.

## Screenshots

### Board view

![Masar board view](docs/assets/board.png)

Move tasks between columns with drag-and-drop, add tasks inline, and filter the board without losing context. Switch to the list view from the toolbar.

### Calendar view

![Masar calendar view](docs/assets/calendar.png)

See scheduled work in month, week and day views. Drag tasks onto a date to schedule them, or move them back to the Unscheduled panel.

### Task details

![Masar task details](docs/assets/task-details.png)

Edit the title and description, change status, priority, due date and labels, check off subtasks and leave comments.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Cmd/Ctrl+K` | Search tasks and boards |
| `N` | Create a task on the current board |
| `?` | Show the shortcut guide |
| `Space` | Pick up a task with its drag handle |
| `Esc` | Close a panel or dialog |
| `Tab` | Move through controls and fields |

## Get Masar

Masar is distributed as a desktop application. Download the latest build for your platform from GitHub [Releases](https://github.com/aartan/masar/releases):

- macOS: `.dmg` for Apple Silicon or Intel.
- Windows: `.exe` installer for x64.
- Linux: `.rpm`, `.deb` or `.AppImage` for x64 and arm64.

## Cloud sync

The local workspace is free and does not require an account. Cloud sync runs on hosted infrastructure and requires an active subscription.

## Technology

Built with Electron, Vite, React, React Router, Tailwind CSS, Hono, Drizzle ORM and SQLite (libSQL), with dnd-kit for drag-and-drop, Zod for validation, and Vitest and Playwright for testing.
