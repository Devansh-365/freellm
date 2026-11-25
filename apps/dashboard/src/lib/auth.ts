/**
 * Dashboard sign-in state.
 *
 * The gateway only checks keys when FREELLM_API_KEY, FREELLM_ADMIN_KEY, or
 * virtual keys are configured. The dashboard finds out from a 401 (or a 403
 * admin_required) on any API call, shows the sign-in screen, and then sends
 * the key as a bearer header on every request. A fully open gateway never
 * answers 401, so the sign-in screen never appears there.
 */
import { useSyncExternalStore } from "react";

const STORAGE_KEY = "freellm.dashboard.key";
const STORAGES = ["sessionStorage", "localStorage"] as const;

/** Why the sign-in screen is showing. */
export type SignInReason = "missing" | "invalid" | "forbidden";

export interface AuthState {
  /** Key attached to every API call, or null when none is set. */
  key: string | null;
  /** Set while the sign-in screen should show. */
  signInReason: SignInReason | null;
  /** Bumped on sign-in and sign-out so the app remounts with a fresh cache. */
  session: number;
}

function readStoredKey(): string | null {
  for (const name of STORAGES) {
    try {
      const value = window[name].getItem(STORAGE_KEY);
      if (value) return value;
    } catch {
      // Storage can be blocked (private mode, sandboxed frames). Ignore.
    }
  }
  return null;
}

/** Store the key in sessionStorage, or localStorage when `remember` is set. Null clears both. */
function writeStoredKey(key: string | null, remember = false): void {
  for (const name of STORAGES) {
    try {
      if (key !== null && (name === "localStorage") === remember) {
        window[name].setItem(STORAGE_KEY, key);
      } else {
        window[name].removeItem(STORAGE_KEY);
      }
    } catch {
      // Without storage the key still lives in memory for this tab.
    }
  }
}

let state: AuthState = { key: readStoredKey(), signInReason: null, session: 0 };
const listeners = new Set<() => void>();

function setState(patch: Partial<AuthState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): AuthState {
  return state;
}

export function useAuth(): AuthState {
  return useSyncExternalStore(subscribe, getSnapshot);
}

export function getApiKey(): string | null {
  return state.key;
}

export function authHeader(key: string | null): Record<string, string> {
  return key ? { Authorization: `Bearer ${key}` } : {};
}

const AUTH_ERROR_CODES = new Set(["missing_api_key", "invalid_api_key", "admin_required"]);

/** True for gateway error bodies that mean "sign in". Retrying those is pointless. */
export function isAuthError(err: unknown): boolean {
  const code = (err as { error?: { code?: unknown } } | null)?.error?.code;
  return typeof code === "string" && AUTH_ERROR_CODES.has(code);
}

/**
 * Called by the fetch wrappers on a failed response. A 401 or a 403
 * admin_required opens the sign-in screen. Responses to requests sent with
 * a different key than the current one are ignored, so a stale in-flight
 * request cannot undo a sign-in that just happened.
 */
export function reportAuthFailure(sentKey: string | null, status: number, code?: unknown): void {
  if (sentKey !== state.key || state.signInReason) return;

  let reason: SignInReason | null = null;
  if (status === 401) reason = sentKey ? "invalid" : "missing";
  else if (status === 403 && code === "admin_required") reason = "forbidden";
  if (!reason) return;

  if (sentKey) writeStoredKey(null);
  setState({ key: null, signInReason: reason });
}

export type VerifyResult = { ok: true } | { ok: false; message: string };

/**
 * Check a key before saving it. /api/v1/status proves the gateway accepts
 * it. The virtual-keys inventory is admin-only when FREELLM_ADMIN_KEY is
 * set, so a 403 there means the key is not the admin key and the
 * dashboard's admin calls would fail right after sign-in.
 */
export async function verifyKey(key: string): Promise<VerifyResult> {
  const headers = { Accept: "application/json", ...authHeader(key) };
  try {
    const status = await fetch("/api/v1/status", { headers });
    if (status.status === 401) {
      return { ok: false, message: "The gateway did not accept that key." };
    }
    if (!status.ok) {
      return { ok: false, message: `The gateway answered ${status.status}. Try again.` };
    }
    const admin = await fetch("/api/v1/status/virtual-keys", { headers });
    if (admin.status === 403) {
      return {
        ok: false,
        message: "That key works for the API but not for admin routes. Use FREELLM_ADMIN_KEY.",
      };
    }
    return { ok: true };
  } catch {
    return { ok: false, message: "Could not reach the gateway." };
  }
}

export function signIn(key: string, remember: boolean): void {
  writeStoredKey(key, remember);
  setState({ key, signInReason: null, session: state.session + 1 });
}

export function signOut(): void {
  writeStoredKey(null);
  setState({ key: null, signInReason: null, session: state.session + 1 });
}
