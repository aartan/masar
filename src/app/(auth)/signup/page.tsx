import type { Metadata } from "next";

import { AuthForm } from "@/components/auth/auth-form";
import { AuthPanel } from "@/components/auth/auth-panel";

export const metadata: Metadata = {
  title: "Create account",
};

export default function SignUpPage() {
  return (
    <AuthPanel
      title="Create your account"
      description="Start with a clean slate or add demo content to explore."
    >
      <AuthForm mode="signup" />
    </AuthPanel>
  );
}
