"use client";

import * as React from "react";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CreateBoardDialog } from "@/components/board/create-board-dialog";
import { cn } from "@/lib/utils";

export function NewBoardButton({
  className,
  variant = "default",
  size = "default",
  label = "New board",
}: {
  className?: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
  label?: string;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button
        variant={variant}
        size={size}
        onClick={() => setOpen(true)}
        className={cn(className)}
      >
        <Plus className="size-4" />
        {label}
      </Button>
      <CreateBoardDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
