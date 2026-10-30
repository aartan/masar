"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function ThemeToggle({
  withLabel = false,
  showTooltip = true,
}: {
  withLabel?: boolean;
  showTooltip?: boolean;
}) {
  const { theme, setTheme } = useTheme();
  const mounted = React.useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  const trigger = (
    <DropdownMenuTrigger asChild>
      <Button
        variant={withLabel ? "ghost" : "ghost"}
        size={withLabel ? "sm" : "icon-sm"}
        className={withLabel ? "w-full justify-start gap-2" : undefined}
        aria-label="Change theme"
      >
        <Sun className="size-4 dark:hidden" />
        <Moon className="hidden size-4 dark:block" />
        {withLabel && <span>Appearance</span>}
      </Button>
    </DropdownMenuTrigger>
  );

  return (
    <DropdownMenu>
      {showTooltip && !withLabel ? (
        <Tooltip>
          <TooltipTrigger asChild>{trigger}</TooltipTrigger>
          <TooltipContent side="right">Appearance</TooltipContent>
        </Tooltip>
      ) : (
        trigger
      )}
      <DropdownMenuContent align="end" side={withLabel ? "top" : "bottom"}>
        <DropdownMenuLabel>Appearance</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={mounted ? theme : "system"}
          onValueChange={setTheme}
        >
          <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">System</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
