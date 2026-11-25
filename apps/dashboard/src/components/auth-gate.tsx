import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { type SignInReason, signIn, useAuth, verifyKey } from "@/lib/auth";
import { useQueryClient } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import { Fragment, useState } from "react";
import { FreeLLMLogo } from "./logo";

const REASON_TEXT: Record<SignInReason, string> = {
  missing: "This gateway requires a key to view the dashboard.",
  invalid: "The saved key was rejected. Sign in again.",
  forbidden: "The saved key does not have admin access. Sign in with your admin key.",
};

/**
 * Renders the app, or the sign-in screen once an API call has come back
 * 401 / 403. Remounts the app on every sign-in and sign-out so queries
 * start fresh with the new key.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const { signInReason, session } = useAuth();
  if (signInReason) return <SignInScreen reason={signInReason} />;
  return <Fragment key={session}>{children}</Fragment>;
}

function SignInScreen({ reason }: { reason: SignInReason }) {
  const queryClient = useQueryClient();
  const [key, setKey] = useState("");
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = key.trim();
    if (!trimmed || checking) return;

    setChecking(true);
    setError(null);
    const result = await verifyKey(trimmed);
    setChecking(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    // Drop everything cached from the failed, keyless requests.
    queryClient.clear();
    signIn(trimmed, remember);
  };

  return (
    <div className="relative flex min-h-[100dvh] w-full items-center justify-center bg-background p-4 font-sans text-foreground">
      <div className="fixed inset-0 bg-[linear-gradient(to_right,#64748b06_1px,transparent_1px),linear-gradient(to_bottom,#64748b06_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none" />

      <Card className="relative z-10 w-full max-w-sm animate-in fade-in duration-300">
        <CardHeader className="space-y-3">
          <div className="flex items-center gap-2.5">
            <FreeLLMLogo size={26} />
            <span className="font-mono text-sm font-bold leading-none tracking-tight">FreeLLM</span>
          </div>
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2 font-mono text-base">
              <KeyRound className="h-4 w-4 text-primary" /> Sign in
            </CardTitle>
            <CardDescription>{REASON_TEXT[reason]}</CardDescription>
          </div>
        </CardHeader>

        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="dashboard-key" className="text-xs font-mono text-muted-foreground">
                Admin key
              </label>
              <Input
                id="dashboard-key"
                type="password"
                autoComplete="off"
                spellCheck={false}
                autoFocus
                value={key}
                onChange={(e) => setKey(e.target.value)}
                className="font-mono"
              />
              <p className="text-xs leading-relaxed text-muted-foreground">
                Your <code className="font-mono text-foreground/80">FREELLM_ADMIN_KEY</code>, or{" "}
                <code className="font-mono text-foreground/80">FREELLM_API_KEY</code> if you haven't
                set an admin key.
              </p>
            </div>

            <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="h-4 w-4 cursor-pointer accent-primary"
              />
              Remember on this device
            </label>

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}

            <Button type="submit" className="w-full" disabled={checking || !key.trim()}>
              {checking ? "Checking..." : "Sign in"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
