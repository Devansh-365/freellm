import { getHealthCheckQueryKey, useHealthCheck } from "@/api/hooks";
import { Button } from "@/components/ui/button";
import { signOut, useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { Activity, Box, LogOut, Terminal } from "lucide-react";
import { Link, useLocation } from "wouter";
import { FreeLLMLogo } from "./logo";

const navItems = [
  { href: "/", label: "Dashboard", icon: Activity },
  { href: "/models", label: "Models", icon: Box },
  { href: "/quickstart", label: "Quickstart", icon: Terminal },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const queryClient = useQueryClient();
  const { key: signedInKey } = useAuth();
  const { data: health, isLoading } = useHealthCheck({
    query: { refetchInterval: 10000, queryKey: getHealthCheckQueryKey() },
  });

  // Only shown when a key is stored. Clearing the cache drops data fetched
  // with the old key; the app then remounts and asks for a key if needed.
  const handleSignOut = () => {
    queryClient.clear();
    signOut();
  };

  const gatewayDot = isLoading
    ? "bg-muted"
    : health?.status === "ok"
      ? "bg-primary shadow-[0_0_6px_hsl(158_50%_46%/0.6)]"
      : "bg-destructive shadow-[0_0_6px_hsl(0_65%_55%/0.6)]";

  return (
    <div className="flex flex-col min-h-[100dvh] w-full bg-background text-foreground font-sans selection:bg-primary/30 dark overflow-x-hidden">
      {/* ── Desktop top navigation bar ── */}
      <header className="hidden md:block border-b border-white/[0.06] bg-sidebar/80 backdrop-blur-md relative z-20 shrink-0">
        <div className="max-w-7xl mx-auto px-8 h-14 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <div className="flex items-center gap-2.5">
              <FreeLLMLogo size={26} />
              <span className="font-mono font-bold tracking-tight text-sm leading-none">
                FreeLLM
              </span>
            </div>

            <nav className="flex items-center gap-1">
              {navItems.map((item) => {
                const isActive = location === item.href;
                return (
                  <Link key={item.href} href={item.href}>
                    <div
                      className={cn(
                        "flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 cursor-pointer",
                        isActive
                          ? "bg-primary/10 text-primary"
                          : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground",
                      )}
                    >
                      <item.icon
                        className={cn(
                          "w-3.5 h-3.5",
                          isActive ? "text-primary" : "text-muted-foreground",
                        )}
                      />
                      {item.label}
                    </div>
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.04] text-xs font-mono">
              <div className={cn("w-2 h-2 rounded-full shrink-0 transition-colors", gatewayDot)} />
              <span className="text-muted-foreground">Gateway</span>
              <span className="uppercase text-[10px] tracking-widest text-foreground/70">
                {isLoading ? "..." : health?.status || "UNK"}
              </span>
            </div>
            {signedInKey && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSignOut}
                className="h-8 gap-1.5 rounded-lg px-3 text-xs font-mono text-muted-foreground hover:bg-white/[0.04] hover:text-foreground"
              >
                <LogOut className="w-3.5 h-3.5" />
                Sign out
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* ── Mobile top bar (logo + status only, no hamburger) ── */}
      <header className="md:hidden sticky top-0 z-20 flex items-center justify-between px-4 py-3 border-b border-white/[0.06] bg-sidebar/80 backdrop-blur-md">
        <div className="flex items-center gap-2.5">
          <FreeLLMLogo size={24} />
          <span className="font-mono font-bold tracking-tight text-sm">FreeLLM</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/[0.03] border border-white/[0.04] text-xs font-mono">
            <div className={cn("w-1.5 h-1.5 rounded-full", gatewayDot)} />
            <span className="uppercase tracking-widest text-[10px] text-foreground/70">
              {isLoading ? "..." : health?.status || "UNK"}
            </span>
          </div>
          {signedInKey && (
            <Button
              variant="ghost"
              size="icon"
              onClick={handleSignOut}
              aria-label="Sign out"
              className="h-7 w-7 rounded-lg text-muted-foreground hover:bg-white/[0.04] hover:text-foreground"
            >
              <LogOut className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
      </header>

      {/* ── Main content area ── */}
      <div className="flex-1 relative min-w-0">
        {/* Grid background */}
        <div className="fixed inset-0 bg-[linear-gradient(to_right,#64748b06_1px,transparent_1px),linear-gradient(to_bottom,#64748b06_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none" />
        <div className="fixed inset-0 bg-gradient-to-b from-background via-background to-background/95 pointer-events-none" />

        {/* Page content */}
        <main className="relative z-10 p-4 md:px-8 md:py-8 pb-24 md:pb-8">
          <div className="max-w-7xl mx-auto">{children}</div>
        </main>
      </div>

      {/* ── Mobile bottom tab bar (sticky) ── */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-30 border-t border-white/[0.06] bg-sidebar/95 backdrop-blur-lg">
        <div className="flex pb-[env(safe-area-inset-bottom)]">
          {navItems.map((item) => {
            const isActive = location === item.href;
            return (
              <Link key={item.href} href={item.href} className="flex-1">
                <div
                  className={cn(
                    "flex flex-col items-center justify-center gap-1 py-2.5 transition-colors relative",
                    isActive ? "text-primary" : "text-muted-foreground",
                  )}
                >
                  <item.icon className="w-5 h-5" />
                  <span className="text-[10px] font-mono tracking-wide">{item.label}</span>
                  {isActive && (
                    <div className="absolute bottom-0 w-10 h-0.5 bg-primary rounded-t" />
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
