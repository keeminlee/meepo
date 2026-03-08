"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, BookOpen, History, Sparkles, SlidersHorizontal } from "lucide-react";
import type { ComponentType } from "react";
import { useCampaignContext } from "@/components/providers/campaign-context-provider";

type SidebarItem = {
  key: "dashboard" | "sessions" | "compendium" | "settings";
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  disabled?: boolean;
};

export function AppSidebar() {
  const pathname = usePathname();
  const { activeCampaignSlug } = useCampaignContext();

  const hasActiveCampaign = Boolean(activeCampaignSlug);
  const sessionsHref = hasActiveCampaign ? `/campaigns/${activeCampaignSlug}/sessions` : "/dashboard";
  const compendiumHref = hasActiveCampaign ? `/campaigns/${activeCampaignSlug}/compendium` : "/dashboard";

  const items: SidebarItem[] = [
    { key: "dashboard", href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { key: "sessions", href: sessionsHref, label: "Sessions", icon: History, disabled: !hasActiveCampaign },
    { key: "compendium", href: compendiumHref, label: "Compendium", icon: BookOpen, disabled: !hasActiveCampaign },
    { key: "settings", href: "/settings", label: "Settings", icon: SlidersHorizontal },
  ];

  return (
    <aside className="sidebar-gradient hidden w-64 flex-col border-r border-sidebar-border lg:flex">
      <Link
        href="/"
        className="flex items-center gap-3 p-6 transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-[0_0_15px_var(--color-primary)]">
          <Sparkles className="h-5 w-5" />
        </div>
        <span className="truncate text-xl font-bold italic tracking-tight">Meepo</span>
      </Link>
      <nav className="mt-2 flex-1 space-y-1 px-3">
        {items.map((item) => {
          const isActive =
            item.key === "dashboard"
              ? pathname.startsWith("/dashboard")
              : item.key === "sessions"
                ? pathname.includes("/sessions") && pathname.startsWith("/campaigns/")
                : item.key === "compendium"
                  ? pathname.includes("/compendium") && pathname.startsWith("/campaigns/")
                  : pathname.startsWith("/settings");
          const itemClassName = `group flex w-full items-center rounded-lg px-3 py-2.5 text-sm transition-all ${
            isActive
              ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-[inset_0_0_0_1px_hsla(42,70%,65%,0.1)]"
              : item.disabled
                ? "text-muted-foreground/60"
                : "text-sidebar-foreground hover:bg-sidebar-accent/50"
          } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background cursor-pointer`;

          return (
            <Link
              key={item.key}
              href={item.href}
              className={itemClassName}
              aria-disabled={item.disabled ? true : undefined}
              tabIndex={item.disabled ? -1 : undefined}
              onClick={(event) => {
                if (item.disabled) {
                  event.preventDefault();
                }
              }}
            >
              <item.icon className={`h-5 w-5 ${isActive ? "text-primary" : "text-muted-foreground"}`} />
              <span className="ml-3 truncate font-medium">{item.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-sidebar-border p-4 text-xs text-muted-foreground">
        Local dev shell
      </div>
    </aside>
  );
}
