import { useRef, useState, useMemo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDownUp, Search, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { RequestDetail } from "@/components/request-detail";
import type { RequestLogEntry } from "@workspace/api-client-react/schemas";

function StatusBadge({ status }: { status: string }) {
  if (status === "success") {
    return <Badge variant="outline" className="bg-primary/5 text-primary border-primary/15 text-[10px] uppercase rounded-md font-normal py-0">OK</Badge>;
  }
  if (status === "rate_limited") {
    return <Badge variant="outline" className="bg-amber-500/5 text-amber-400 border-amber-500/15 text-[10px] uppercase rounded-md font-normal py-0">429</Badge>;
  }
  return <Badge variant="outline" className="bg-destructive/5 text-destructive border-destructive/15 text-[10px] uppercase rounded-md font-normal py-0">ERR</Badge>;
}

interface RequestListProps {
  requests: RequestLogEntry[];
}

function matchesFilter(req: RequestLogEntry, q: string): boolean {
  const lower = q.toLowerCase();
  return [
    req.requestedModel,
    req.resolvedModel,
    req.provider,
    req.status,
    req.error,
    req.finishReason,
  ].some((v) => v?.toLowerCase().includes(lower));
}

export function RequestList({ requests }: RequestListProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");

  const filtered = useMemo(
    () => (query.trim() ? requests.filter((r) => matchesFilter(r, query)) : requests),
    [requests, query],
  );

  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => {
      const id = filtered[index]?.id;
      return id && expanded.has(id) ? 200 : 40;
    },
    overscan: 10,
    measureElement: (el) => el.getBoundingClientRect().height,
  });

  function toggleRow(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-4">
        <h2 className="text-lg font-mono font-semibold flex items-center gap-2 text-foreground shrink-0">
          <ArrowDownUp className="w-4 h-4 text-muted-foreground" /> Recent Requests
          {query.trim() && <span className="text-sm font-normal text-muted-foreground">({filtered.length}/{requests.length})</span>}
        </h2>
        <div className="relative max-w-xs w-full">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by model, provider, status…"
            className="pl-8 h-8 text-xs font-mono bg-card border-white/[0.06] focus-visible:ring-1 focus-visible:ring-white/20"
          />
        </div>
      </div>

      <div className="rounded-xl border border-white/[0.04] bg-card overflow-hidden">
        {/* Header */}
        <div className="grid grid-cols-[80px_140px_1fr_150px_150px_120px] px-4 py-2 border-b border-white/[0.04]">
          {(["Time", "Status", "Model", "Provider", "Tokens", "Latency"] as const).map((h) => (
            <span key={h} className={cn("font-mono text-[10px] uppercase tracking-widest text-muted-foreground font-medium", (h === "Tokens" || h === "Latency") && "text-right")}>
              {h}
            </span>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="flex items-center justify-center h-28 text-muted-foreground font-mono text-sm">
            {requests.length === 0 ? "No requests yet. Waiting for traffic..." : "No matches."}
          </div>
        ) : (
          <div
            ref={parentRef}
            className="h-[600px] overflow-y-auto"
          >
            <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
              {virtualizer.getVirtualItems().map((vItem) => {
                const req = filtered[vItem.index]!;
                const isExpanded = expanded.has(req.id);
                const hasTokens = req.promptTokens != null || req.completionTokens != null;

                return (
                  <div
                    key={req.id}
                    data-index={vItem.index}
                    ref={virtualizer.measureElement}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${vItem.start}px)`,
                    }}
                  >
                    {/* Summary row */}
                    <button
                      className={cn(
                        "grid grid-cols-[80px_140px_1fr_150px_150px_120px] w-full px-4 py-2.5 text-left font-mono text-sm transition-colors duration-150",
                        "border-b border-white/[0.03] hover:bg-white/[0.02]",
                        isExpanded && "bg-white/[0.02]",
                      )}
                      onClick={() => toggleRow(req.id)}
                    >
                      <span className="text-muted-foreground text-xs whitespace-nowrap">
                        {new Date(req.timestamp).toLocaleTimeString(undefined, { hour12: false, fractionalSecondDigits: 2 })}
                      </span>
                      <span className="flex items-center gap-1.5 flex-wrap">
                        <StatusBadge status={req.status} />
                        {req.cached && (
                          <Badge variant="outline" className="bg-cyan-400/5 text-cyan-400 border-cyan-400/15 text-[10px] uppercase rounded-md font-normal py-0">CACHE</Badge>
                        )}
                      </span>
                      <span className="truncate" title={req.requestedModel}>{req.requestedModel}</span>
                      <span className="text-muted-foreground">{req.provider || "-"}</span>
                      <span className="text-xs whitespace-nowrap">
                        {hasTokens ? (
                          <span className="text-amber-400/70" title={`${req.promptTokens ?? 0} prompt → ${req.completionTokens ?? 0} completion`}>
                            {req.promptTokens ?? 0}<span className="text-muted-foreground/50 mx-0.5">→</span>{req.completionTokens ?? 0}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/50">-</span>
                        )}
                      </span>
                      <span className="text-right">
                        <span className={cn("inline-flex items-center gap-1 justify-end", req.latencyMs > 2000 ? "text-amber-400" : "text-muted-foreground")}>
                          {req.latencyMs > 2000 && <Zap className="w-3 h-3" />}
                          {req.latencyMs}ms
                        </span>
                      </span>
                    </button>

                    {/* Inline expand */}
                    {isExpanded && <RequestDetail id={req.id} />}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
