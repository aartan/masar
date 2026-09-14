import type { Metadata } from "next";

import { AuthForm } from "@/components/auth/auth-form";
import { AuthPanel } from "@/components/auth/auth-panel";

export const metadata: Metadata = {
  title: "Create account",
};

export default function SignUpPage() {
  return (
    <AuthPanel
      title="Create your workspace"
      description="Your boards are private to this account. Start empty or add demo content to explore."
      footer="One account, one private workspace — no teams or shared data."
    >
      <AuthForm mode="signup" />
    </AuthPanel>
  );
}
