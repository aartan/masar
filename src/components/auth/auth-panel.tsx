import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Card } from "@/components/ui/card";

export function AuthPanel({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="animate-rise">
      <Card className="relative overflow-hidden border-border/70 px-6 py-6 shadow-float sm:px-7 sm:py-7">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent"
        />
        <div className="flex items-center justify-between gap-3">
          <Logo />
          <ThemeToggle />
        </div>
        <div className="mt-8">
          <h1 className="font-display text-[24px] leading-tight font-semibold text-foreground">
            {title}
          </h1>
          <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
            {description}
          </p>
        </div>
        <div className="mt-6">{children}</div>
      </Card>
    </div>
  );
}
