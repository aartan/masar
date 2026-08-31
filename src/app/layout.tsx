import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";

import "./globals.css";
import { AppShell } from "@/components/layout/app-shell";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { listBoards } from "@/lib/server/boards";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: {
    default: "Masar — Kanban project management",
    template: "%s · Masar",
  },
  description:
    "A keyboard-first Kanban workspace for planning work and moving it from backlog to completion.",
  applicationName: "Masar",
  authors: [{ name: "Masar" }],
  openGraph: {
    title: "Masar — Kanban project management",
    description:
      "A keyboard-first Kanban workspace for planning work and moving it from backlog to completion.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f6f1" },
    { media: "(prefers-color-scheme: dark)", color: "#111512" },
  ],
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const boards = await listBoards();

  return (
    <html lang="en" suppressHydrationWarning data-scroll-behavior="smooth">
      <body
        className={`${GeistSans.variable} ${GeistMono.variable} font-sans`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <TooltipProvider>
            <AppShell boards={boards}>{children}</AppShell>
            <Toaster />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
