import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";

import { AuthPanel } from "@/components/auth/auth-panel";
import { DesktopOfflineOption } from "@/components/auth/desktop-offline-option";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Masar Sync for desktop",
};

/**
 * First screen shown when the desktop app switches to sync mode. Electron has
 * its own cookie jar, so a browser sign-up does not sign the app in; this page
 * makes that explicit and offers both sign-in and account creation. Signed-in
 * users are redirected to the workspace by the auth layout.
 */
export default function DesktopSyncPage() {
  return (
    <AuthPanel
      title="Sync your desktop workspace"
      description="Sign in to your Masar account or start a free trial to keep your boards in sync across devices."
    >
      <div className="space-y-4">
        <div className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2.5 text-[11.5px] leading-relaxed text-muted-foreground">
          The desktop app keeps its own secure sign-in. If you created your
          account in a browser, use the same email and password here. Your local
          offline workspace is never changed by signing in.
        </div>

        <div className="grid gap-2">
          <Button asChild>
            <Link href="/login">
              Sign in
              <ArrowRight className="size-4" />
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/signup">
              <Sparkles className="size-4" />
              Create an account
            </Link>
          </Button>
        </div>

        <DesktopOfflineOption />
      </div>
    </AuthPanel>
  );
}
