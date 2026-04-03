import React from "react";
import { Link, useLocation } from "wouter";
import { Activity, Box, Terminal, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useHealthCheck } from "@workspace/api-client-react";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { data: health, isLoading } = useHealthCheck({ query: { refetchInterval: 10000 } });

  const navItems = [
    { href: "/", label: "Dashboard", icon: Activity },
    { href: "/models", label: "Models", icon: Box },
    { href: "/quickstart", label: "Quickstart", icon: Terminal },
  ];

  return (
    <div className="flex h-screen w-full bg-background text-foreground overflow-hidden font-sans selection:bg-primary/30 dark">
      {/* Sidebar */}
      <div className="w-64 border-r border-border bg-card/50 flex flex-col backdrop-blur-sm relative z-10">
        <div className="p-6">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 bg-primary text-primary-foreground flex items-center justify-center font-bold rounded-sm shadow-[0_0_15px_rgba(var(--color-primary),0.3)]">
              F
            </div>
            <span className="font-mono font-bold tracking-tight text-lg">FreeLLM</span>
          </div>
        </div>

        <nav className="flex-1 px-4 space-y-1">
          {navItems.map((item) => {
            const isActive = location === item.href;
            return (
              <Link key={item.href} href={item.href} className="block">
                <div
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer group",
                    isActive
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                  )}
                >
                  <item.icon className={cn("w-4 h-4", isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground")} />
                  {item.label}
                  {isActive && <ChevronRight className="w-3 h-3 ml-auto text-primary" />}
                </div>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 mt-auto">
          <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-secondary/30 text-xs font-mono">
            <div className={cn("w-2 h-2 rounded-full", isLoading ? "bg-muted" : health?.status === "ok" ? "bg-primary shadow-[0_0_5px_rgba(var(--color-primary),0.8)]" : "bg-destructive shadow-[0_0_5px_rgba(var(--color-destructive),0.8)]")} />
            <span className="text-muted-foreground">Gateway</span>
            <span className="ml-auto uppercase text-[10px] tracking-widest">{health?.status || "UNK"}</span>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden relative">
        {/* Subtle grid background */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px] pointer-events-none" />
        <div className="absolute inset-0 bg-background/80 pointer-events-none" />
        
        <main className="flex-1 overflow-y-auto z-10 p-8">
          <div className="max-w-6xl mx-auto">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
