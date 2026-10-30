import type { Metadata } from "next";

import { AuthForm } from "@/components/auth/auth-form";
import { AuthPanel } from "@/components/auth/auth-panel";
import { DesktopOfflineOption } from "@/components/auth/desktop-offline-option";

export const metadata: Metadata = {
  title: "Sign in",
};

export default function LoginPage() {
  return (
    <AuthPanel
      title="Sign in to Masar"
      description="Enter your email and password to continue."
    >
      <div className="space-y-4">
        <AuthForm mode="login" />
        <DesktopOfflineOption />
      </div>
    </AuthPanel>
  );
}
