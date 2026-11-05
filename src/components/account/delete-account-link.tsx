import { Trash2 } from "lucide-react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";

export function DeleteAccountLink() {
  return (
    <div className="mt-8 border-t border-border/60 pt-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[12.5px] font-medium text-foreground/80">
            Delete account
          </p>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">
            Permanently remove your account and synced data.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          asChild
          className="text-destructive/80 hover:bg-destructive/5 hover:text-destructive"
        >
          <Link to="/account/delete">
            <Trash2 />
            Delete account
          </Link>
        </Button>
      </div>
    </div>
  );
}
