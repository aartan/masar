# Masar

Masar is an app for organizing projects, managing tasks, and tracking progress. Create boards, organize columns, set priorities and due dates, manage subtasks and comments, and monitor upcoming work from your dashboard.

Create an account with a 14-day free trial and select Start with demo content to explore a populated workspace.

![Masar dashboard](docs/screenshots/dashboard.png)

## Get Masar
Masar is available as a web app and as desktop applications for macOS and Windows.

- Web: Try online [demo](https://next-kanban-gamma.vercel.app/)
- macOS: Download the version for your Mac (Apple Silicon or Intel) from GitHub Releases.
- Windows: Download the Windows (x64) installer from GitHub Releases.

The desktop apps work offline by default, storing your workspace locally without requiring an account. Account sync connects the app to the hosted Masar web app; the desktop app has its own secure sign-in, so use the same email and password you used in the browser.

## Features
- Boards and columns: Create, customize, reorder, and organize project boards.
- Task management: Track descriptions, priorities, due dates, labels, subtasks, and comments.
- Drag and drop: Move and reorder tasks using a mouse or keyboard.
- Board and list views: Switch views, search tasks, apply filters, and sort results.
- Dashboard: Review open tasks, upcoming deadlines, recent activity, and project progress.
- Private workspaces: Each online account has its own workspace, isolated from other accounts.
- Themes and responsive layouts: Light, dark, and system themes, with desktop and mobile-friendly navigation.
- Offline desktop use: Work locally on macOS or Windows for free, with optional online sync through a subscription.

## Subscriptions & billing

The online workspace requires an active subscription or trial. Signup collects a
card through Stripe Checkout; the account is created only after Stripe confirms
the trial or subscription. Cancelling keeps access through the end of the paid
period, and expired accounts can still manage billing or sign out. The desktop
app can always switch back to its free local offline workspace without touching
local data.

See [docs/billing.md](docs/billing.md) for Stripe product, price, Customer
Portal, webhook, environment, migration, and test-card setup.

## Technology

Built with Next.js, React, Tailwind CSS, Drizzle ORM, SQLite/libSQL, Better Auth, Stripe, Electron, dnd-kit, Zod, Vitest, and Playwright.
