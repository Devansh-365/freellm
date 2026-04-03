import { useState } from "react";
import { useListModels, getListModelsQueryKey } from "@workspace/api-client-react";
import { Box, Copy, Check, Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={copy}
      className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
      title="Copy model ID"
    >
      {copied ? <Check className="w-3 h-3 text-primary" /> : <Copy className="w-3 h-3" />}
    </button>
  );
}

const PROVIDER_LABELS: Record<string, string> = {
  groq: "Groq",
  gemini: "Gemini",
  mistral: "Mistral",
  cerebras: "Cerebras",
  ollama: "Ollama",
  freellm: "FreeLLM Meta",
};

export default function Models() {
  const [search, setSearch] = useState("");
  const { data: models, isLoading } = useListModels({
    query: {
      refetchInterval: 30000,
      queryKey: getListModelsQueryKey(),
    },
  });

  const allModels = models?.data ?? [];

  const filtered = search
    ? allModels.filter(
        (m) =>
          m.id.toLowerCase().includes(search.toLowerCase()) ||
          m.owned_by.toLowerCase().includes(search.toLowerCase())
      )
    : allModels;

  // Group by provider
  const grouped = filtered.reduce<Record<string, typeof filtered>>((acc, m) => {
    const p = m.owned_by ?? "unknown";
    if (!acc[p]) acc[p] = [];
    acc[p].push(m);
    return acc;
  }, {});

  const providerOrder = ["freellm", "groq", "gemini", "mistral", "cerebras", "ollama"];
  const sortedGroups = Object.entries(grouped).sort(([a], [b]) => {
    const ai = providerOrder.indexOf(a);
    const bi = providerOrder.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-mono font-bold tracking-tight flex items-center gap-3">
            <Box className="w-7 h-7 text-muted-foreground" /> Models
          </h1>
          <p className="text-muted-foreground mt-1">
            All models available through the gateway, grouped by provider.
          </p>
        </div>
        <Badge variant="outline" className="mt-1 font-mono text-xs border-primary/30 text-primary bg-primary/5">
          {allModels.length} total
        </Badge>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter models..."
          className="pl-9 font-mono bg-card border-border/50 focus-visible:ring-primary/30"
        />
      </div>

      {isLoading ? (
        <div className="space-y-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse space-y-2">
              <div className="h-5 w-24 bg-muted rounded" />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {[1, 2, 3].map((j) => <div key={j} className="h-14 bg-card rounded-lg" />)}
              </div>
            </div>
          ))}
        </div>
      ) : sortedGroups.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground font-mono">
          No models found.
        </div>
      ) : (
        <div className="space-y-8">
          {sortedGroups.map(([provider, providerModels]) => (
            <div key={provider}>
              <div className="flex items-center gap-3 mb-3">
                <h2 className="text-sm font-mono font-semibold uppercase tracking-widest text-muted-foreground">
                  {PROVIDER_LABELS[provider] ?? provider}
                </h2>
                <div className="flex-1 h-px bg-border/40" />
                <span className="text-xs font-mono text-muted-foreground">{providerModels.length}</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                {providerModels.map((model) => (
                  <Card
                    key={model.id}
                    className={cn(
                      "group border-border/40 bg-card/50 hover:bg-card/80 transition-colors",
                      provider === "freellm" && "border-primary/20 bg-primary/5 hover:bg-primary/10"
                    )}
                  >
                    <CardContent className="p-3 flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p
                          className={cn(
                            "font-mono text-sm truncate",
                            provider === "freellm" ? "text-primary font-semibold" : "text-foreground"
                          )}
                          title={model.id}
                        >
                          {model.id}
                        </p>
                        <p className="text-xs text-muted-foreground font-mono mt-0.5">
                          {model.object}
                        </p>
                      </div>
                      <CopyButton value={model.id} />
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
