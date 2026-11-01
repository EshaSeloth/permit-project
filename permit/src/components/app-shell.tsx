import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";

import { SIcon } from "./ui-kit";

import { ProductNotes } from "./product-notes";

interface NavEntry {
  id: string;
  label: string;
  path: "/" | "/leak-test";
  icon: "message-square" | "shield-check";
}

const NAV_ITEMS: NavEntry[] = [
  { id: "assistant", label: "Assistant", path: "/", icon: "message-square" },
  { id: "leak-test", label: "Leak test", path: "/leak-test", icon: "shield-check" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const active = NAV_ITEMS.find((i) => i.path === pathname)?.id ?? "assistant";
  const isPhone = useIsPhone();

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <aside className={isPhone ? "w-14 shrink-0 border-r border-border bg-sidebar" : "w-60 shrink-0 border-r border-border bg-sidebar"}>
        {!isPhone && (
          <div className="px-4 pb-2 pt-4">
            <p className="text-base font-bold text-foreground">PERMIT</p>
            <p className="text-xs leading-snug text-muted-foreground">Permission-aware knowledge base system</p>
          </div>
        )}
        <nav aria-label="Main" className="space-y-1 p-2">
          {NAV_ITEMS.map((i) => (
            <Link
              key={i.id}
              to={i.path}
              aria-label={i.label}
              className={
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors " +
                (active === i.id
                  ? "bg-accent font-medium text-accent-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground")
              }
            >
              <SIcon name={i.icon} size={18} />
              {!isPhone && <span>{i.label}</span>}
            </Link>
          ))}
        </nav>
      </aside>
      <main className="flex min-h-screen min-w-0 flex-1 flex-col overflow-y-auto">
        <div className="flex-1">{children}</div>
        {/* Pages end with 32px of bottom padding, so mt-4 gives ~48px above the divider. */}
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6">
          <ProductNotes className="mt-4" />
        </div>
      </main>
    </div>
  );
}

/** True below 640px, where the sidebar collapses to icons so the page keeps its full width. */
function useIsPhone(): boolean {
  const [isPhone, setIsPhone] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia("(max-width: 639px)");
    const update = () => setIsPhone(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);
  return isPhone;
}
