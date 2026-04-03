import React, { useState } from "react";
import { useGetGatewayStatus, useResetProviderCircuitBreaker, useUpdateRoutingStrategy, getGetGatewayStatusQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Activity, ArrowRightLeft, CheckCircle2, XCircle, AlertTriangle, RefreshCw, Server, ArrowDownUp, Clock, Zap } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export default function Dashboard() {
  const queryClient = useQueryClient();
  const { data: status, isLoading } = useGetGatewayStatus({ 
    query: { 
      refetchInterval: 3000, 
      queryKey: getGetGatewayStatusQueryKey() 
    } 
  });

  const resetCircuitBreaker = useResetProviderCircuitBreaker({
    mutation: {
      onSuccess: () => {
        toast.success("Circuit breaker reset");
        queryClient.invalidateQueries({ queryKey: getGetGatewayStatusQueryKey() });
      },
      onError: () => toast.error("Failed to reset circuit breaker")
    }
  });

  const updateRouting = useUpdateRoutingStrategy({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetGatewayStatusQueryKey() });
      }
    }
  });

  const handleRoutingToggle = (checked: boolean) => {
    updateRouting.mutate({
      data: { strategy: checked ? "round_robin" : "random" }
    });
  };

  const getStatusColor = (state: string, enabled: boolean) => {
    if (!enabled) return "bg-muted text-muted-foreground border-muted";
    switch(state) {
      case "closed": return "bg-primary/10 text-primary border-primary/20";
      case "open": return "bg-destructive/10 text-destructive border-destructive/20";
      case "half_open": return "bg-amber-500/10 text-amber-500 border-amber-500/20";
      default: return "bg-muted text-muted-foreground border-muted";
    }
  };

  const getStatusText = (state: string, enabled: boolean) => {
    if (!enabled) return "Disabled";
    switch(state) {
      case "closed": return "Healthy";
      case "open": return "Failing";
      case "half_open": return "Testing";
      default: return "Unknown";
    }
  };

  if (isLoading && !status) {
    return <div className="animate-pulse space-y-8">
      <div className="h-10 w-48 bg-muted rounded"></div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4"><div className="h-32 bg-card rounded-lg"></div><div className="h-32 bg-card rounded-lg"></div><div className="h-32 bg-card rounded-lg"></div></div>
    </div>;
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-mono font-bold tracking-tight">Gateway Status</h1>
          <p className="text-muted-foreground mt-1 text-sm">Real-time metrics and routing control.</p>
        </div>
        
        <div className="flex items-center gap-3 bg-card border border-border px-3 py-2 rounded-md shadow-sm self-start sm:self-auto">
          <span className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <ArrowRightLeft className="w-4 h-4 shrink-0" />
            <span className="hidden sm:inline">Routing:</span>
            <span className="text-foreground uppercase tracking-widest text-xs font-mono">{status?.routingStrategy?.replace("_", " ")}</span>
          </span>
          <Switch 
            checked={status?.routingStrategy === "round_robin"} 
            onCheckedChange={handleRoutingToggle}
            disabled={updateRouting.isPending}
            className="data-[state=checked]:bg-primary"
          />
        </div>
      </div>

      {/* Global Metrics */}
      <div className="grid grid-cols-3 gap-2 md:gap-4">
        <Card className="bg-card/50 backdrop-blur-sm border-border/50">
          <CardContent className="p-3 md:p-6">
            <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-4">
              <div className="hidden md:flex p-3 bg-secondary/50 rounded-md w-fit">
                <Activity className="w-5 h-5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-xs md:text-sm font-medium text-muted-foreground">Total</p>
                <p className="text-2xl md:text-3xl font-mono font-bold">{status?.totalRequests.toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card className="bg-card/50 backdrop-blur-sm border-border/50">
          <CardContent className="p-3 md:p-6">
            <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-4">
              <div className="hidden md:flex p-3 bg-primary/10 rounded-md w-fit">
                <CheckCircle2 className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-xs md:text-sm font-medium text-muted-foreground">Success</p>
                <p className="text-2xl md:text-3xl font-mono font-bold text-primary">{status?.successRequests.toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card/50 backdrop-blur-sm border-border/50">
          <CardContent className="p-3 md:p-6">
            <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-4">
              <div className="hidden md:flex p-3 bg-destructive/10 rounded-md w-fit">
                <XCircle className="w-5 h-5 text-destructive" />
              </div>
              <div>
                <p className="text-xs md:text-sm font-medium text-muted-foreground">Failed</p>
                <p className="text-2xl md:text-3xl font-mono font-bold text-destructive">{status?.failedRequests.toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Provider Health Grid */}
      <div>
        <h2 className="text-xl font-mono font-bold mb-4 flex items-center gap-2">
          <Server className="w-5 h-5 text-muted-foreground" /> Providers
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
          {status?.providers.map((provider) => (
            <Card key={provider.id} className={cn("overflow-hidden border-border/50 bg-card/50 backdrop-blur-sm transition-all", !provider.enabled && "opacity-60")}>
              <CardHeader className="pb-3 border-b border-border/30">
                <div className="flex justify-between items-start">
                  <div>
                    <CardTitle className="font-mono text-lg">{provider.name}</CardTitle>
                    <CardDescription className="text-xs font-mono mt-1">{provider.id}</CardDescription>
                  </div>
                  <Badge variant="outline" className={cn("uppercase text-[10px] tracking-wider", getStatusColor(provider.circuitBreakerState, provider.enabled))}>
                    {getStatusText(provider.circuitBreakerState, provider.enabled)}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="p-4 pt-4 space-y-4">
                <div className="grid grid-cols-2 gap-2 text-sm font-mono">
                  <div className="flex flex-col p-2 bg-secondary/30 rounded-md border border-border/20">
                    <span className="text-muted-foreground text-xs uppercase">Success</span>
                    <span className="text-foreground">{provider.successRequests}</span>
                  </div>
                  <div className="flex flex-col p-2 bg-secondary/30 rounded-md border border-border/20">
                    <span className="text-muted-foreground text-xs uppercase">Failed</span>
                    <span className={cn("text-foreground", provider.failedRequests > 0 && "text-destructive")}>{provider.failedRequests}</span>
                  </div>
                </div>

                {provider.lastError && (
                  <div className="p-2 rounded border border-destructive/20 bg-destructive/5 text-xs text-destructive flex items-start gap-2 overflow-hidden">
                    <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                    <span className="truncate" title={provider.lastError}>{provider.lastError}</span>
                  </div>
                )}

                <div className="flex items-center justify-between pt-2">
                  <div className="text-xs text-muted-foreground font-mono flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {provider.lastUsedAt ? new Date(provider.lastUsedAt).toLocaleTimeString() : 'Never'}
                  </div>
                  {(provider.circuitBreakerState === "open" || provider.circuitBreakerState === "half_open") && (
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={() => resetCircuitBreaker.mutate({ providerId: provider.id })}
                      disabled={resetCircuitBreaker.isPending}
                      className="h-7 text-xs border-amber-500/30 text-amber-500 hover:bg-amber-500/10 hover:text-amber-500"
                    >
                      <RefreshCw className={cn("w-3 h-3 mr-1", resetCircuitBreaker.isPending && "animate-spin")} /> Reset
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Recent Logs Table */}
      <div>
        <h2 className="text-xl font-mono font-bold mb-4 flex items-center gap-2">
          <ArrowDownUp className="w-5 h-5 text-muted-foreground" /> Recent Requests
        </h2>
        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-border/30 hover:bg-transparent">
                  <TableHead className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Time</TableHead>
                  <TableHead className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Status</TableHead>
                  <TableHead className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Model</TableHead>
                  <TableHead className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Provider</TableHead>
                  <TableHead className="font-mono text-xs uppercase tracking-wider text-muted-foreground text-right">Latency</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!status?.recentRequests?.length ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={5} className="text-center h-24 text-muted-foreground font-mono text-sm">
                      No requests yet. Waiting for traffic...
                    </TableCell>
                  </TableRow>
                ) : (
                  status.recentRequests.map((req) => (
                    <TableRow key={req.id} className="border-border/10 border-b hover:bg-secondary/30 transition-colors font-mono text-sm">
                      <TableCell className="text-muted-foreground whitespace-nowrap text-xs">
                        {new Date(req.timestamp).toLocaleTimeString(undefined, {hour12: false, fractionalSecondDigits: 2})}
                      </TableCell>
                      <TableCell>
                        {req.status === "success" ? (
                          <Badge variant="outline" className="bg-primary/5 text-primary border-primary/20 text-[10px] uppercase rounded-sm font-normal py-0">OK</Badge>
                        ) : req.status === "rate_limited" ? (
                          <Badge variant="outline" className="bg-amber-500/5 text-amber-500 border-amber-500/20 text-[10px] uppercase rounded-sm font-normal py-0">429</Badge>
                        ) : (
                          <Badge variant="outline" className="bg-destructive/5 text-destructive border-destructive/20 text-[10px] uppercase rounded-sm font-normal py-0">ERR</Badge>
                        )}
                      </TableCell>
                      <TableCell className="max-w-[150px] truncate" title={req.requestedModel}>
                        {req.requestedModel}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {req.provider || "-"}
                      </TableCell>
                      <TableCell className="text-right">
                        <span className={cn("inline-flex items-center gap-1", req.latencyMs > 2000 ? "text-amber-500" : "text-muted-foreground")}>
                          {req.latencyMs > 2000 && <Zap className="w-3 h-3" />}
                          {req.latencyMs}ms
                        </span>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </Card>
      </div>
    </div>
  );
}
