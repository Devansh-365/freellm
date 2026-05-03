import { useState, useEffect } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { Layout } from "@/components/layout";
import Dashboard from "@/pages/dashboard";
import Models from "@/pages/models";
import Quickstart from "@/pages/quickstart";
import NotFound from "@/pages/not-found";
import LoginPage from "@/pages/login";

const queryClient = new QueryClient();

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/models" component={Models} />
        <Route path="/quickstart" component={Quickstart} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

type AuthState = "loading" | "ok" | "login";

function AuthGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>("loading");

  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then((r) => setState(r.ok ? "ok" : "login"))
      .catch(() => setState("login"));
  }, []);

  if (state === "loading") {
    return (
      <div className="min-h-screen w-full bg-background dark flex items-center justify-center">
        <div className="w-5 h-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  if (state === "login") {
    return <LoginPage onSuccess={() => setState("ok")} />;
  }

  return <>{children}</>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
        <AuthGate>
          <Router />
        </AuthGate>
      </WouterRouter>
      <Toaster theme="dark" position="bottom-right" />
    </QueryClientProvider>
  );
}

export default App;
