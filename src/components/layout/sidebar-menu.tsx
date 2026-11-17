"use client";

import * as React from "react";
import type { LucideIcon } from "lucide-react";

import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export interface SidebarMenuAction {
  key: string;
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  variant?: "default" | "destructive";
  disabled?: boolean;
  /** Draw a separator above this item. */
  separatorBefore?: boolean;
}

type SidebarMenuActionsProps = {
  actions: SidebarMenuAction[];
};

function ActionLabel({ action }: { action: SidebarMenuAction }) {
  const Icon = action.icon;
  return (
    <>
      <Icon />
      {action.label}
    </>
  );
}

export function SidebarContextMenuContent({
  actions,
  className,
  ...props
}: Omit<
  React.ComponentProps<typeof ContextMenuContent>,
  "children"
> &
  SidebarMenuActionsProps) {
  return (
    <ContextMenuContent className={cn("w-[190px]", className)} {...props}>
      {actions.map((action) => (
        <React.Fragment key={action.key}>
          {action.separatorBefore && <ContextMenuSeparator />}
          <ContextMenuItem
            variant={action.variant}
            disabled={action.disabled}
            onSelect={() => action.onSelect()}
          >
            <ActionLabel action={action} />
          </ContextMenuItem>
        </React.Fragment>
      ))}
    </ContextMenuContent>
  );
}

export function SidebarDropdownMenuContent({
  actions,
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuContent> & SidebarMenuActionsProps) {
  return (
    <DropdownMenuContent className={cn("w-[190px]", className)} {...props}>
      {actions.map((action) => (
        <React.Fragment key={action.key}>
          {action.separatorBefore && <DropdownMenuSeparator />}
          <DropdownMenuItem
            variant={action.variant}
            disabled={action.disabled}
            onSelect={() => action.onSelect()}
          >
            <ActionLabel action={action} />
          </DropdownMenuItem>
        </React.Fragment>
      ))}
    </DropdownMenuContent>
  );
}
