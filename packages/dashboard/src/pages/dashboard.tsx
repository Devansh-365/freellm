import { useGetGatewayStatus, useResetProviderCircuitBreaker, useUpdateRoutingStrategy, getGetGatewayStatusQueryKey, useGetRequests, getGetRequestsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Server } from "lucide-react";
import { toast } from "sonner";
import { RoutingToggle } from "@/components/routing-toggle";
import { MetricsRow } from "@/components/metrics-row";
import { ProviderCard } from "@/components/provider-card";
import { RequestList } from "@/components/request-list";
import { VirtualKeysPanel } from "@/components/virtual-keys-panel";
import { BrowserTokensCard } from "@/components/browser-tokens-card";

export default function Dashboard() {
  const queryClient = useQueryClient();
  const { data: status, isLoading } = useGetGatewayStatus({
    query: { refetchInterval: 3000, queryKey: getGetGatewayStatusQueryKey() },
  });

  const { data: requestsPage } = useGetRequests(
    { limit: 500 },
    { query: { refetchInterval: 3000, queryKey: getGetRequestsQueryKey({ limit: 500 }) } },
  );

  const resetCircuitBreaker = useResetProviderCircuitBreaker({
    mutation: {
      onSuccess: () => {
        toast.success("Circuit breaker reset");
        queryClient.invalidateQueries({ queryKey: getGetGatewayStatusQueryKey() });
      },
      onError: () => toast.error("Failed to reset circuit breaker"),
    },
  });

  const updateRouting = useUpdateRoutingStrategy({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetGatewayStatusQueryKey() });
      },
    },
  });

  if (isLoading && !status) {
    return (
      <div className="animate-pulse space-y-8">
        <div className="h-10 w-48 bg-muted rounded" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="h-32 bg-card rounded-lg" />
          <div className="h-32 bg-card rounded-lg" />
          <div className="h-32 bg-card rounded-lg" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
        <div>
          <h1 className="text-2xl font-mono font-semibold tracking-tight">Gateway Status</h1>
          <p className="text-muted-foreground mt-1 text-sm">Real-time metrics and routing control.</p>
        </div>
        <RoutingToggle
          strategy={status?.routingStrategy}
          onToggle={(checked) => updateRouting.mutate({ data: { strategy: checked ? "round_robin" : "random" } })}
          disabled={updateRouting.isPending}
        />
      </div>

      <MetricsRow
        total={status?.totalRequests ?? 0}
        success={status?.successRequests ?? 0}
        failed={status?.failedRequests ?? 0}
        tokens={status?.usage?.totalTokens ?? 0}
        cacheHits={status?.cache?.hits ?? 0}
        cacheHitRate={status?.cache?.hitRate ?? 0}
      />

      <div>
        <h2 className="text-lg font-mono font-semibold mb-4 flex items-center gap-2 text-foreground">
          <Server className="w-4 h-4 text-muted-foreground" /> Providers
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {status?.providers.map((provider) => (
            <ProviderCard
              key={provider.id}
              provider={provider}
              onReset={(id) => resetCircuitBreaker.mutate({ providerId: id })}
              resetPending={resetCircuitBreaker.isPending}
            />
          ))}
        </div>
      </div>

      {/* Trust row: virtual keys and browser token status side by side on
          large screens, stacked on mobile. Virtual keys renders nothing
          when no keys are loaded, so the browser-token card takes the
          full width in that case via the grid's auto-fill behaviour. */}
      <div className="flex flex-col lg:flex-row gap-3 items-start">
        <VirtualKeysPanel />
        {status?.browserTokens && (
          <BrowserTokensCard info={status.browserTokens} />
        )}
      </div>

      <RequestList requests={requestsPage?.requests ?? []} />
    </div>
  );
}
