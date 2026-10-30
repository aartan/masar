"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { toast } from "sonner";

import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

export function AccountHeader({
  user,
}: {
  user: { name: string; email: string };
}) {
  const router = useRouter();
  const [signingOut, setSigningOut] = React.useState(false);

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      const { error } = await authClient.signOut();
      if (error) throw new Error(error.message ?? "Could not sign out.");
      router.push("/login");
      router.refresh();
    } catch {
      toast.error("Could not sign out", {
        description: "Please try again.",
      });
      setSigningOut(false);
    }
  }

  return (
    <header className="border-b border-border/70 bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-4xl items-center gap-3 px-4 sm:px-6">
        <Logo showTagline={false} />
        <div className="ml-auto flex min-w-0 items-center gap-1">
          <span className="mr-2 hidden truncate text-[12px] text-muted-foreground sm:block">
            {user.email}
          </span>
          <ThemeToggle />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void signOut()}
            disabled={signingOut}
          >
            <LogOut className="size-3.5" />
            <span className="hidden sm:inline">
              {signingOut ? "Signing out…" : "Sign out"}
            </span>
          </Button>
        </div>
      </div>
    </header>
  );
}
