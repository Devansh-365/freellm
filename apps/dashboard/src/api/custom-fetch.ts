/**
 * Custom fetch wrapper for Orval-generated API client.
 *
 * Attaches the dashboard key (if signed in) and reports 401/403 responses
 * to the sign-in flow in lib/auth.
 */
import { authHeader, getApiKey, reportAuthFailure } from "@/lib/auth";

export type ErrorType<T> = T;
export type BodyType<T> = T;

export const customFetch = async <T>(
  url: string,
  options: RequestInit & { data?: unknown } = {},
): Promise<T> => {
  const { data, headers: customHeaders, ...rest } = options;
  const key = getApiKey();

  const response = await fetch(url, {
    ...rest,
    headers: {
      "Content-Type": "application/json",
      ...authHeader(key),
      ...customHeaders,
    },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({
      error: { message: response.statusText, type: "api_error" },
    }));
    reportAuthFailure(key, response.status, error?.error?.code);
    throw error;
  }

  return response.json() as Promise<T>;
};
