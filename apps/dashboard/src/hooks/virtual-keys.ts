import type { VirtualKeysResponse } from "@/api/schemas";
/**
 * Dashboard-local hook for the admin-only virtual keys inventory
 * endpoint. Kept out of the generated api-client because it is a
 * recently added endpoint and we would rather not regenerate the whole
 * client for a single read-only route.
 */
import { authHeader, getApiKey, reportAuthFailure } from "@/lib/auth";
import { useQuery } from "@tanstack/react-query";

const VIRTUAL_KEYS_URL = "/api/v1/status/virtual-keys";

export const virtualKeysQueryKey = [VIRTUAL_KEYS_URL] as const;

async function fetchVirtualKeys(signal?: AbortSignal): Promise<VirtualKeysResponse | null> {
  const key = getApiKey();
  const res = await fetch(VIRTUAL_KEYS_URL, {
    signal,
    headers: { Accept: "application/json", ...authHeader(key) },
  });
  // 401 / 403 mean the dashboard has no key or a non-admin key. Hand that
  // to the sign-in flow and surface "no data" so the panel renders an
  // empty state instead of an error.
  if (res.status === 401 || res.status === 403) {
    const body = await res.json().catch(() => null);
    reportAuthFailure(key, res.status, body?.error?.code);
    return null;
  }
  if (!res.ok) throw new Error(`virtual-keys fetch failed: ${res.status}`);
  return (await res.json()) as VirtualKeysResponse;
}

export function useVirtualKeys() {
  return useQuery({
    queryKey: virtualKeysQueryKey,
    queryFn: ({ signal }) => fetchVirtualKeys(signal),
    refetchInterval: 5000,
    retry: false,
  });
}
