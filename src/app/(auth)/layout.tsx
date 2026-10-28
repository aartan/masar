import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export default async function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await getCurrentUser();
  if (user) redirect("/");

  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden bg-background px-4 py-10">
      <div
        aria-hidden="true"
        className="dot-grid pointer-events-none absolute inset-0 opacity-50"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-40 left-1/2 size-[34rem] -translate-x-1/2 rounded-full bg-primary/6 blur-3xl"
      />
      <div className="relative w-full max-w-[420px]">{children}</div>
    </main>
  );
}
