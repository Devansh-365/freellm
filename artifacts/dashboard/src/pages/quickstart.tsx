import { useState } from "react";
import { Terminal, Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const BASE_URL = `${window.location.origin}/api/v1`;

function CodeBlock({ code, language }: { code: string; language: string }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group rounded-md border border-border/50 bg-[#0a0a0a] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border/30 bg-secondary/20">
        <span className="text-xs font-mono text-muted-foreground uppercase tracking-widest">{language}</span>
        <button
          onClick={copy}
          className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground hover:text-foreground transition-colors"
        >
          {copied ? (
            <><Check className="w-3 h-3 text-primary" /> Copied</>
          ) : (
            <><Copy className="w-3 h-3" /> Copy</>
          )}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 text-sm font-mono text-foreground leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function Section({ step, title, children }: { step: number; title: string; children: React.ReactNode }) {
  return (
    <div className="relative pl-10">
      <div className="absolute left-0 top-0.5 w-6 h-6 rounded-full border border-primary/40 bg-primary/10 flex items-center justify-center">
        <span className="text-xs font-mono text-primary font-bold">{step}</span>
      </div>
      <h2 className="text-lg font-mono font-semibold mb-3">{title}</h2>
      {children}
    </div>
  );
}

const pythonCode = `from openai import OpenAI

client = OpenAI(
    api_key="not-needed",     # Any string works — FreeLLM ignores it
    base_url="${BASE_URL}",
)

response = client.chat.completions.create(
    model="free",             # or "free-fast", "free-smart", or a specific model
    messages=[
        {"role": "user", "content": "Hello! Who are you?"}
    ],
)

print(response.choices[0].message.content)`;

const tsCode = `import OpenAI from "openai";

const client = new OpenAI({
  apiKey: "not-needed",       // Any string works — FreeLLM ignores it
  baseURL: "${BASE_URL}",
  dangerouslyAllowBrowser: true,  // Remove if using from a server
});

const response = await client.chat.completions.create({
  model: "free",              // or "free-fast", "free-smart", or a specific model
  messages: [
    { role: "user", content: "Hello! Who are you?" },
  ],
});

console.log(response.choices[0].message.content);`;

const curlCode = `curl ${BASE_URL}/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer not-needed" \\
  -d '{
    "model": "free",
    "messages": [
      {"role": "user", "content": "Hello! Who are you?"}
    ]
  }'`;

const streamCode = `# Streaming is also supported
response = client.chat.completions.create(
    model="free-fast",
    messages=[{"role": "user", "content": "Tell me a story."}],
    stream=True,
)

for chunk in response:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="", flush=True)`;

export default function Quickstart() {
  return (
    <div className="space-y-10 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-mono font-bold tracking-tight flex items-center gap-3">
          <Terminal className="w-7 h-7 text-muted-foreground" /> Quickstart
        </h1>
        <p className="text-muted-foreground mt-1">
          Point your existing OpenAI SDK at FreeLLM — no other changes needed.
        </p>
      </div>

      <div className="space-y-8">
        <Section step={1} title="Gateway endpoint">
          <p className="text-sm text-muted-foreground mb-3">
            All requests go to this base URL. It's fully OpenAI-compatible.
          </p>
          <div className="flex items-center gap-3 px-4 py-3 rounded-md bg-card border border-primary/20 font-mono text-sm">
            <span className="text-muted-foreground">base_url</span>
            <span className="text-primary font-semibold flex-1">{BASE_URL}</span>
          </div>
        </Section>

        <div className="w-full h-px bg-border/30" />

        <Section step={2} title="Choose a model">
          <p className="text-sm text-muted-foreground mb-3">
            Use a meta-model that auto-selects the best available free provider, or pick a specific one.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {[
              { id: "free", desc: "First available provider", note: "Best for reliability" },
              { id: "free-fast", desc: "Groq → Cerebras → Gemini → Mistral", note: "Optimized for speed" },
              { id: "free-smart", desc: "Gemini → Groq → Mistral → Cerebras", note: "Optimized for quality" },
            ].map((m) => (
              <div
                key={m.id}
                className="p-3 rounded-md border border-primary/20 bg-primary/5 space-y-1"
              >
                <p className="font-mono text-sm font-semibold text-primary">{m.id}</p>
                <p className="text-xs text-muted-foreground">{m.desc}</p>
                <p className="text-xs text-primary/60 italic">{m.note}</p>
              </div>
            ))}
          </div>
        </Section>

        <div className="w-full h-px bg-border/30" />

        <Section step={3} title="Python (openai SDK)">
          <CodeBlock code={pythonCode} language="python" />
        </Section>

        <div className="w-full h-px bg-border/30" />

        <Section step={4} title="TypeScript / Node.js (openai SDK)">
          <CodeBlock code={tsCode} language="typescript" />
        </Section>

        <div className="w-full h-px bg-border/30" />

        <Section step={5} title="curl">
          <CodeBlock code={curlCode} language="bash" />
        </Section>

        <div className="w-full h-px bg-border/30" />

        <Section step={6} title="Streaming">
          <p className="text-sm text-muted-foreground mb-3">
            Streaming is fully supported and proxied transparently from the underlying provider.
          </p>
          <CodeBlock code={streamCode} language="python" />
        </Section>
      </div>

      <div className="p-4 rounded-md border border-border/40 bg-card/30 text-sm text-muted-foreground font-mono">
        <span className="text-foreground font-semibold">Note: </span>
        FreeLLM ignores the Authorization header — you can pass any string or leave it empty. Provider API keys are configured server-side via environment variables.
      </div>
    </div>
  );
}
