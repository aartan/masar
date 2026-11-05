import { CreditCard, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";

interface SubscribeActionProps {
  busy: string | null;
  onCheckout: () => void;
}

export function SubscribeButton({ busy, onCheckout }: SubscribeActionProps) {
  return (
    <Button onClick={onCheckout} disabled={busy !== null}>
      {busy === "checkout" ? (
        <Loader2 className="animate-spin" />
      ) : (
        <CreditCard />
      )}
      Subscribe
    </Button>
  );
}

export function SubscribeSection({ busy, onCheckout }: SubscribeActionProps) {
  return (
    <div className="mt-8 border-t border-border/60 pt-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[12.5px] font-medium text-foreground/80">
            Subscribe
          </p>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">
            Start a subscription to unlock cloud sync across your devices.
          </p>
        </div>
        <SubscribeButton busy={busy} onCheckout={onCheckout} />
      </div>
    </div>
  );
}
