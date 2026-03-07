import Link from "next/link";
import { LayoutDashboard, Map as MapIcon, History, Sparkles } from "lucide-react";
import type { ComponentType } from "react";

type SidebarItem = {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  active?: boolean;
};

type AppSidebarProps = {
  activePath: string;
};

export function AppSidebar({ activePath }: AppSidebarProps) {
  const items: SidebarItem[] = [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/campaigns/shattered-crown", label: "Campaigns", icon: MapIcon },
    { href: "/sessions/s1", label: "Sessions", icon: History },
  ];

  return (
    <aside className="sidebar-gradient hidden w-64 flex-col border-r border-sidebar-border lg:flex">
      <div className="flex items-center gap-3 p-6">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-[0_0_15px_var(--color-primary)]">
          <Sparkles className="h-5 w-5" />
        </div>
        <span className="truncate text-xl font-bold italic tracking-tight">Meepo</span>
      </div>
      <nav className="mt-2 flex-1 space-y-1 px-3">
        {items.map((item) => {
          const isActive = activePath.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`group flex w-full items-center rounded-lg px-3 py-2.5 text-sm transition-all ${
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-[inset_0_0_0_1px_hsla(42,70%,65%,0.1)]"
                  : "text-sidebar-foreground hover:bg-sidebar-accent/50"
              }`}
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
