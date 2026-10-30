import { AccountHeader } from "@/components/subscription/account-header";
import { requireAuthUser } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

/**
 * Billing pages are auth-only: a signed-in account with no active subscription
 * must still be able to manage billing and sign out.
 */
export default async function AccountLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await requireAuthUser();

  return (
    <div className="min-h-dvh bg-background">
      <AccountHeader user={{ name: user.name, email: user.email }} />
      <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
        {children}
      </main>
    </div>
  );
}
