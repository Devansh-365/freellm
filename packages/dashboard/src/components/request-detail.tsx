import { useGetRequestById } from "@workspace/api-client-react";
import { Copy } from "lucide-react";

function CopyButton({ text }: { text: string }) {
  return (
    <button
      className="p-1 rounded hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors"
      onClick={() => navigator.clipboard.writeText(text)}
      title="Copy to clipboard"
    >
      <Copy className="w-3.5 h-3.5" />
    </button>
  );
}

function BodySection({ label, body, chunkCount }: { label: string; body: unknown; chunkCount?: number }) {
  const text = typeof body === "string" ? body : JSON.stringify(body, null, 2);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{label}</span>
        <div className="flex items-center gap-2">
          {chunkCount != null && (
            <span className="font-mono text-[10px] text-muted-foreground/60">Chunks: {chunkCount}</span>
          )}
          <CopyButton text={text} />
        </div>
      </div>
      <pre className="text-xs font-mono bg-black/20 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-words max-h-64 overflow-y-auto text-foreground/80">
        {text || <span className="text-muted-foreground/50">(empty)</span>}
      </pre>
    </div>
  );
}

export function RequestDetail({ id }: { id: string }) {
  const { data, isLoading, isError } = useGetRequestById(id);

  if (isLoading) {
    return (
      <div className="p-4 space-y-3 animate-pulse">
        <div className="h-4 bg-muted rounded w-1/3" />
        <div className="h-24 bg-muted rounded" />
        <div className="h-4 bg-muted rounded w-1/3" />
        <div className="h-24 bg-muted rounded" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="p-4 text-destructive font-mono text-sm">
        Failed to load request details.
      </div>
    );
  }

  return (
    <div className="px-4 pb-4 pt-2 space-y-3 border-t border-white/[0.04]">
      {data.requestBody != null && (
        <BodySection label="Request" body={data.requestBody} />
      )}
      {data.responseBody != null && (
        <BodySection
          label="Response"
          body={data.responseBody}
          chunkCount={data.streaming ? data.chunkCount : undefined}
        />
      )}
      {data.requestBody == null && data.responseBody == null && (
        <p className="text-muted-foreground font-mono text-xs py-2">No body captured.</p>
      )}
    </div>
  );
}
