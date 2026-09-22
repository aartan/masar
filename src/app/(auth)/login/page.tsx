import type { Metadata } from "next";

import { AuthForm } from "@/components/auth/auth-form";
import { AuthPanel } from "@/components/auth/auth-panel";

export const metadata: Metadata = {
  title: "Sign in",
};

export default function LoginPage() {
  return (
    <AuthPanel
      title="Sign in to Masar"
      description="Enter your email and password to continue."
    >
      <AuthForm mode="login" />
    </AuthPanel>
  );
}
