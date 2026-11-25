import { cn } from "@/lib/utils";
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const BASE_URL = `${window.location.origin}/api/v1`;

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group">
      <button
        type="button"
        onClick={copy}
        className="absolute top-3 right-3 flex items-center gap-1.5 text-xs font-mono text-muted-foreground hover:text-foreground transition-colors duration-150 cursor-pointer z-10"
      >
        {copied ? (
          <>
            <Check className="w-3 h-3 text-primary" /> Copied
          </>
        ) : (
          <>
            <Copy className="w-3 h-3" /> Copy
          </>
        )}
      </button>
      <pre className="overflow-x-auto p-4 pt-10 text-sm font-mono text-foreground/90 leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function Section({
  step,
  title,
  children,
}: { step: number; title: string; children: React.ReactNode }) {
  return (
    <div className="relative pl-10 md:pl-12 min-w-0">
      <div className="absolute left-0 top-0 w-7 h-7 rounded-lg border border-primary/15 bg-primary/[0.06] flex items-center justify-center">
        <span className="text-xs font-mono text-primary font-semibold">{step}</span>
      </div>
      <h2 className="text-base font-mono font-semibold mb-3 tracking-tight">{title}</h2>
      {children}
    </div>
  );
}

const tabs = [
  { id: "python", label: "Python" },
  { id: "typescript", label: "TypeScript" },
  { id: "curl", label: "curl" },
  { id: "streaming", label: "Streaming" },
] as const;

type TabId = (typeof tabs)[number]["id"];

const codeByTab: Record<TabId, string> = {
  python: `from openai import OpenAI

client = OpenAI(
    api_key="not-needed",     # Your key, if the gateway requires one
    base_url="${BASE_URL}",
)

response = client.chat.completions.create(
    model="free",             # or "free-fast", "free-smart"
    messages=[
        {"role": "user", "content": "Hello! Who are you?"}
    ],
)

print(response.choices[0].message.content)`,

  typescript: `import OpenAI from "openai";

const client = new OpenAI({
  apiKey: "not-needed",
  baseURL: "${BASE_URL}",
  dangerouslyAllowBrowser: true,  // Remove if using from a server
});

const response = await client.chat.completions.create({
  model: "free",
  messages: [
    { role: "user", content: "Hello! Who are you?" },
  ],
});

console.log(response.choices[0].message.content);`,

  curl: `curl ${BASE_URL}/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer not-needed" \\
  -d '{
    "model": "free",
    "messages": [
      {"role": "user", "content": "Hello! Who are you?"}
    ]
  }'`,

  streaming: `from openai import OpenAI

client = OpenAI(api_key="not-needed", base_url="${BASE_URL}")

response = client.chat.completions.create(
    model="free-fast",
    messages=[{"role": "user", "content": "Tell me a story."}],
    stream=True,
)

for chunk in response:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="", flush=True)`,
};

export default function Quickstart() {
  const [activeTab, setActiveTab] = useState<TabId>("python");

  return (
    <div className="space-y-10 animate-in fade-in duration-500 min-w-0">
      <div>
        <h1 className="text-2xl font-mono font-semibold tracking-tight">Quickstart</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Point your existing OpenAI SDK at FreeLLM. No other changes needed.
        </p>
      </div>

      <div className="space-y-8">
        <Section step={1} title="Gateway endpoint">
          <p className="text-sm text-muted-foreground mb-3">
            All requests go to this base URL. It's fully OpenAI-compatible.
          </p>
          <div className="flex items-center gap-3 px-4 py-3.5 rounded-xl bg-primary/[0.04] border border-primary/10 font-mono text-sm overflow-hidden">
            <span className="text-muted-foreground text-xs shrink-0">base_url</span>
            <span className="text-primary font-medium truncate">{BASE_URL}</span>
          </div>
        </Section>

        <div className="w-full h-px bg-white/[0.04] ml-10 md:ml-12" />

        <Section step={2} title="Choose a model">
          <p className="text-sm text-muted-foreground mb-3">
            Use a meta-model that auto-selects the best available free provider, or pick a specific
            one.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
            {[
              { id: "free", desc: "First available provider", note: "Best for reliability" },
              {
                id: "free-fast",
                desc: "Groq → Cerebras → Gemini → Mistral",
                note: "Optimized for speed",
              },
              {
                id: "free-smart",
                desc: "Gemini → Groq → Mistral → Cerebras",
                note: "Optimized for quality",
              },
            ].map((m) => (
              <div
                key={m.id}
                className="p-4 rounded-xl border border-primary/10 bg-primary/[0.03] space-y-1.5 hover:border-primary/20 transition-colors duration-150"
              >
                <p className="font-mono text-sm font-semibold text-primary">{m.id}</p>
                <p className="text-xs text-muted-foreground leading-relaxed">{m.desc}</p>
                <p className="text-[11px] text-primary/40">{m.note}</p>
              </div>
            ))}
          </div>
        </Section>

        <div className="w-full h-px bg-white/[0.04] ml-10 md:ml-12" />

        <Section step={3} title="Make a request">
          <div className="rounded-xl border border-white/[0.04] bg-[hsl(228_18%_6%)] overflow-hidden max-w-full">
            {/* Tabs */}
            <div className="flex border-b border-white/[0.04]">
              {tabs.map((tab) => (
                <button
                  type="button"
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    "px-4 py-2.5 text-xs font-mono tracking-wide transition-colors duration-150 cursor-pointer relative",
                    activeTab === tab.id
                      ? "text-primary"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {tab.label}
                  {activeTab === tab.id && (
                    <div className="absolute bottom-0 left-2 right-2 h-[2px] bg-primary rounded-t" />
                  )}
                </button>
              ))}
            </div>

            {/* Code */}
            <CodeBlock code={codeByTab[activeTab]} />
          </div>
        </Section>
      </div>

      <div className="p-4 rounded-xl border border-white/[0.04] bg-white/[0.02] text-sm text-muted-foreground font-mono">
        <span className="text-foreground font-medium">Note: </span>
        The Authorization header only matters when the gateway has FREELLM_API_KEY or virtual keys
        configured. Then pass one of those keys as the API key. Otherwise any string works. Provider
        API keys are configured server-side via environment variables.
      </div>
    </div>
  );
}
