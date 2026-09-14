import type { Metadata } from "next";

import { AuthForm } from "@/components/auth/auth-form";
import { AuthPanel } from "@/components/auth/auth-panel";

export const metadata: Metadata = {
  title: "Sign in",
};

export default function LoginPage() {
  return (
    <AuthPanel
      title="Welcome back"
      description="Sign in to pick up your boards, tasks, and everything in motion."
      footer="Sessions are secure, http-only, and last for 30 days on this device."
    >
      <AuthForm mode="login" />
    </AuthPanel>
  );
}
