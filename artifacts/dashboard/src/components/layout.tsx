import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Activity, Box, Terminal, X, Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { useHealthCheck, getHealthCheckQueryKey } from "@workspace/api-client-react";

function FreeLLMLogo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="32" height="32" rx="7" fill="hsl(150 100% 40% / 0.15)" />
      <rect x="0.5" y="0.5" width="31" height="31" rx="6.5" stroke="hsl(150 100% 40% / 0.4)" />
      {/* Routing paths */}
      <circle cx="7" cy="16" r="2" fill="hsl(150 100% 40%)" />
      <circle cx="25" cy="10" r="2" fill="hsl(150 100% 40%)" />
      <circle cx="25" cy="22" r="2" fill="hsl(150 100% 40%)" />
      <circle cx="16" cy="16" r="1.5" fill="hsl(150 100% 40% / 0.6)" />
      {/* Lines from hub to providers */}
      <line x1="9" y1="15.5" x2="14.5" y2="15" stroke="hsl(150 100% 40%)" strokeWidth="1.2" strokeLinecap="round" />
      <line x1="17.5" y1="15" x2="23" y2="10.5" stroke="hsl(150 100% 40%)" strokeWidth="1.2" strokeLinecap="round" />
      <line x1="17.5" y1="17" x2="23" y2="21.5" stroke="hsl(150 100% 40%)" strokeWidth="1.2" strokeLinecap="round" />
      {/* Small tick marks on providers */}
      <line x1="23" y1="8" x2="27" y2="10" stroke="hsl(150 100% 40% / 0.4)" strokeWidth="0.8" strokeLinecap="round" />
      <line x1="23" y1="20" x2="27" y2="22" stroke="hsl(150 100% 40% / 0.4)" strokeWidth="0.8" strokeLinecap="round" />
    </svg>
  );
}

const navItems = [
  { href: "/", label: "Dashboard", icon: Activity },
  { href: "/models", label: "Models", icon: Box },
  { href: "/quickstart", label: "Quickstart", icon: Terminal },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { data: health, isLoading } = useHealthCheck({
    query: { refetchInterval: 10000, queryKey: getHealthCheckQueryKey() },
  });

  const gatewayDot = isLoading
    ? "bg-muted"
    : health?.status === "ok"
    ? "bg-primary shadow-[0_0_5px_hsl(150_100%_40%/0.8)]"
    : "bg-destructive shadow-[0_0_5px_hsl(0_84%_60%/0.8)]";

  return (
    <div className="flex h-screen w-full bg-background text-foreground overflow-hidden font-sans selection:bg-primary/30 dark">

      {/* ── Desktop Sidebar ── */}
      <aside className="hidden md:flex w-60 border-r border-border bg-card/50 flex-col backdrop-blur-sm relative z-10 shrink-0">
        {/* Logo */}
        <div className="p-5 border-b border-border/40">
          <div className="flex items-center gap-3">
            <FreeLLMLogo size={32} />
            <div>
              <span className="font-mono font-bold tracking-tight text-base leading-none block">FreeLLM</span>
              <span className="text-[10px] text-muted-foreground font-mono tracking-widest uppercase">Gateway</span>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {navItems.map((item) => {
            const isActive = location === item.href;
            return (
              <Link key={item.href} href={item.href} className="block">
                <div className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-all cursor-pointer group",
                  isActive
                    ? "bg-primary/10 text-primary border border-primary/20"
                    : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground border border-transparent"
                )}>
                  <item.icon className={cn("w-4 h-4 shrink-0", isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground")} />
                  {item.label}
                </div>
              </Link>
            );
          })}
        </nav>

        {/* Gateway status */}
        <div className="p-4 border-t border-border/40">
          <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-secondary/30 text-xs font-mono">
            <div className={cn("w-2 h-2 rounded-full shrink-0", gatewayDot)} />
            <span className="text-muted-foreground">Gateway</span>
            <span className="ml-auto uppercase text-[10px] tracking-widest">
              {isLoading ? "..." : health?.status || "UNK"}
            </span>
          </div>
        </div>
      </aside>

      {/* ── Mobile: slide-over menu ── */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-background/80 backdrop-blur-sm"
            onClick={() => setMobileMenuOpen(false)}
          />
          {/* Drawer */}
          <aside className="absolute left-0 top-0 bottom-0 w-72 bg-card border-r border-border flex flex-col">
            <div className="p-5 border-b border-border/40 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <FreeLLMLogo size={32} />
                <div>
                  <span className="font-mono font-bold tracking-tight text-base leading-none block">FreeLLM</span>
                  <span className="text-[10px] text-muted-foreground font-mono tracking-widest uppercase">Gateway</span>
                </div>
              </div>
              <button
                onClick={() => setMobileMenuOpen(false)}
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <nav className="flex-1 px-3 py-4 space-y-0.5">
              {navItems.map((item) => {
                const isActive = location === item.href;
                return (
                  <Link key={item.href} href={item.href} className="block" onClick={() => setMobileMenuOpen(false)}>
                    <div className={cn(
                      "flex items-center gap-3 px-3 py-3 rounded-md text-sm font-medium transition-all cursor-pointer group",
                      isActive
                        ? "bg-primary/10 text-primary border border-primary/20"
                        : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground border border-transparent"
                    )}>
                      <item.icon className={cn("w-4 h-4 shrink-0", isActive ? "text-primary" : "")} />
                      {item.label}
                    </div>
                  </Link>
                );
              })}
            </nav>

            <div className="p-4 border-t border-border/40">
              <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-secondary/30 text-xs font-mono">
                <div className={cn("w-2 h-2 rounded-full shrink-0", gatewayDot)} />
                <span className="text-muted-foreground">Gateway</span>
                <span className="ml-auto uppercase text-[10px] tracking-widest">
                  {isLoading ? "..." : health?.status || "UNK"}
                </span>
              </div>
            </div>
          </aside>
        </div>
      )}

      {/* ── Main content area ── */}
      <div className="flex-1 flex flex-col overflow-hidden relative min-w-0">
        {/* Grid background */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px] pointer-events-none" />
        <div className="absolute inset-0 bg-background/80 pointer-events-none" />

        {/* Mobile top bar */}
        <header className="md:hidden relative z-10 flex items-center justify-between px-4 py-3 border-b border-border/50 bg-card/60 backdrop-blur-sm shrink-0">
          <div className="flex items-center gap-2.5">
            <FreeLLMLogo size={28} />
            <span className="font-mono font-bold tracking-tight text-base">FreeLLM</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground">
              <div className={cn("w-1.5 h-1.5 rounded-full", gatewayDot)} />
              <span className="uppercase tracking-widest text-[10px]">
                {isLoading ? "..." : health?.status || "UNK"}
              </span>
            </div>
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
            >
              <Menu className="w-5 h-5" />
            </button>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto z-10 p-4 md:p-8 pb-20 md:pb-8">
          <div className="max-w-6xl mx-auto">
            {children}
          </div>
        </main>

        {/* Mobile bottom tab bar */}
        <nav className="md:hidden relative z-10 border-t border-border/50 bg-card/80 backdrop-blur-sm shrink-0">
          <div className="flex">
            {navItems.map((item) => {
              const isActive = location === item.href;
              return (
                <Link key={item.href} href={item.href} className="flex-1">
                  <div className={cn(
                    "flex flex-col items-center justify-center gap-1 py-2.5 transition-colors",
                    isActive ? "text-primary" : "text-muted-foreground"
                  )}>
                    <item.icon className="w-5 h-5" />
                    <span className="text-[10px] font-mono tracking-wide">{item.label}</span>
                    {isActive && <div className="absolute bottom-0 w-10 h-0.5 bg-primary rounded-t" />}
                  </div>
                </Link>
              );
            })}
          </div>
        </nav>
      </div>
    </div>
  );
}
