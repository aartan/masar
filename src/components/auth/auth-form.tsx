"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Eye,
  EyeOff,
  Loader2,
  LockKeyhole,
  Mail,
  Sparkles,
  UserRound,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { friendlyAuthError } from "@/lib/auth-errors";
import { api, errorMessage } from "@/lib/client-api";
import { emailSchema } from "@/lib/validation";

type AuthMode = "login" | "signup";

export function AuthForm({
  mode,
  trialDays = 14,
  notice,
}: {
  mode: AuthMode;
  trialDays?: number;
  notice?: string | null;
}) {
  const router = useRouter();
  const isSignup = mode === "signup";
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [demoContent, setDemoContent] = React.useState(false);
  const [showPassword, setShowPassword] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;

    const trimmedName = name.trim();

    if (isSignup && trimmedName.length === 0) {
      setError("Enter your name.");
      return;
    }
    const parsedEmail = emailSchema.safeParse(email);
    if (!parsedEmail.success) {
      setError(
        parsedEmail.error.issues[0]?.message ?? "Enter a valid email address.",
      );
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (isSignup && password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setError(null);
    setLoading(true);

    try {
      if (isSignup) {
        const { url } = await api<{ url: string }>("/api/signup/start", {
          method: "POST",
          body: JSON.stringify({
            name: trimmedName,
            email: parsedEmail.data,
            password,
            demoContent,
          }),
        });
        window.location.assign(url);
        return;
      }

      const { error: signInError } = await authClient.signIn.email({
        email: parsedEmail.data,
        password,
      });
      if (signInError) {
        setError(friendlyAuthError(signInError, "Could not sign in."));
        return;
      }

      router.push("/");
      router.refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {isSignup && (
        <div className="space-y-1.5">
          <Label htmlFor="auth-name">Name</Label>
          <div className="relative">
            <UserRound className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground/50" />
            <Input
              id="auth-name"
              name="name"
              autoComplete="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Your name"
              maxLength={80}
              className="pl-9"
              required
              disabled={loading}
            />
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="auth-email">Email</Label>
        <div className="relative">
          <Mail className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground/50" />
          <Input
            id="auth-email"
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            className="pl-9"
            required
            disabled={loading}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="auth-password">Password</Label>
        <div className="relative">
          <LockKeyhole className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground/50" />
          <Input
            id="auth-password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete={isSignup ? "new-password" : "current-password"}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={isSignup ? "At least 8 characters" : "Your password"}
            className="pr-10 pl-9"
            required
            disabled={loading}
          />
          <button
            type="button"
            onClick={() => setShowPassword((visible) => !visible)}
            className="absolute top-1/2 right-2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent/70 hover:text-foreground"
            aria-label={showPassword ? "Hide password" : "Show password"}
            tabIndex={-1}
          >
            {showPassword ? (
              <EyeOff className="size-3.5" />
            ) : (
              <Eye className="size-3.5" />
            )}
          </button>
        </div>
      </div>

      {isSignup && (
        <div className="space-y-1.5">
          <Label htmlFor="auth-confirm-password">Confirm password</Label>
          <div className="relative">
            <LockKeyhole className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground/50" />
            <Input
              id="auth-confirm-password"
              name="confirmPassword"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder="Repeat your password"
              className="pl-9"
              required
              disabled={loading}
            />
          </div>
        </div>
      )}

      {isSignup && (
        <label
          htmlFor="auth-demo-content"
          className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border/70 bg-muted/30 px-3 py-2.5 transition-colors hover:bg-muted/50"
        >
          <Checkbox
            id="auth-demo-content"
            checked={demoContent}
            onCheckedChange={(checked) => setDemoContent(checked === true)}
            disabled={loading}
            className="mt-0.5"
          />
          <span className="min-w-0">
            <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-foreground">
              <Sparkles className="size-3 text-primary" />
              Start with demo content
            </span>
            <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">
              Add a sample board. Leave this off to start with no boards.
            </span>
          </span>
        </label>
      )}

      {notice && (
        <p
          role="status"
          className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-[12px] leading-relaxed text-foreground/80"
        >
          {notice}
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/25 bg-destructive/8 px-3 py-2 text-[12px] leading-relaxed text-destructive"
        >
          {error}
        </p>
      )}

      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? (
          <Loader2 className="size-4 animate-spin" />
        ) : isSignup ? (
          <Sparkles className="size-4" />
        ) : (
          <ArrowRight className="size-4" />
        )}
        {isSignup
          ? loading
            ? "Opening secure checkout…"
            : trialDays > 0
              ? "Start free trial"
              : "Continue to checkout"
          : "Sign in"}
      </Button>

      {isSignup && (
        <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
          {trialDays > 0
            ? `Card required. You won't be charged during your ${trialDays}-day trial. Cancel anytime.`
            : "Secure recurring billing through Stripe. Cancel anytime."}
        </p>
      )}

      <p className="text-center text-[12.5px] text-muted-foreground">
        {isSignup ? "Already have an account?" : "New to Masar?"}{" "}
        <Link
          href={isSignup ? "/login" : "/signup"}
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          {isSignup ? "Sign in" : "Create an account"}
        </Link>
      </p>
    </form>
  );
}
