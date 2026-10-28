import { AppShell } from "@/components/layout/app-shell";
import { listBoards } from "@/lib/server/boards";
import { requireUser } from "@/lib/server/auth";
import { isLocalMode } from "@/lib/server/desktop";

export const dynamic = "force-dynamic";

export default async function WorkspaceLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await requireUser();
  const boards = await listBoards(user.id);

  return (
    <AppShell
      boards={boards}
      user={{ name: user.name, email: user.email }}
      isLocalMode={isLocalMode()}
    >
      {children}
    </AppShell>
  );
}
