import { createHmac, timingSafeEqual } from "node:crypto";

export const COOKIE_NAME = "freellm_session";
const SESSION_TTL_SECONDS = 8 * 60 * 60;

interface SessionPayload {
  iat: number;
  exp: number;
}

/**
 * Signing secret — falls back to FREELLM_DASHBOARD_PASSWORD so operators
 * only need one env var. Separate FREELLM_DASHBOARD_SECRET allows session
 * invalidation without changing the password.
 */
function getSecret(): string | undefined {
  return process.env["FREELLM_DASHBOARD_SECRET"] || process.env["FREELLM_DASHBOARD_PASSWORD"];
}

function signHex(data: string, secret: string): string {
  return createHmac("sha256", secret).update(data).digest("hex");
}

export function signSession(now = Date.now()): string | null {
  const secret = getSecret();
  if (!secret) return null;
  const iat = Math.floor(now / 1000);
  const payload: SessionPayload = { iat, exp: iat + SESSION_TTL_SECONDS };
  const json = JSON.stringify(payload);
  const b64 = Buffer.from(json).toString("base64url");
  const sig = signHex(json, secret);
  return `${b64}.${sig}`;
}

export function verifySession(value: string): boolean {
  const secret = getSecret();
  if (!secret) return false;
  const dot = value.lastIndexOf(".");
  if (dot < 0) return false;
  const b64 = value.slice(0, dot);
  const sigActual = value.slice(dot + 1);
  let json: string;
  try {
    json = Buffer.from(b64, "base64url").toString("utf8");
  } catch {
    return false;
  }
  const sigExpected = signHex(json, secret);
  if (sigActual.length !== sigExpected.length) return false;
  try {
    if (!timingSafeEqual(Buffer.from(sigActual, "hex"), Buffer.from(sigExpected, "hex")))
      return false;
  } catch {
    return false;
  }
  let payload: SessionPayload;
  try {
    payload = JSON.parse(json) as SessionPayload;
  } catch {
    return false;
  }
  return Math.floor(Date.now() / 1000) < payload.exp;
}

export function parseCookieSession(cookieHeader: string | undefined): boolean {
  if (!cookieHeader) return false;
  for (const part of cookieHeader.split(";")) {
    const eqIdx = part.indexOf("=");
    if (eqIdx < 0) continue;
    const name = part.slice(0, eqIdx).trim();
    if (name === COOKIE_NAME) {
      return verifySession(part.slice(eqIdx + 1).trim());
    }
  }
  return false;
}

export function setCookieHeader(value: string, secure: boolean): string {
  const secureFlag = secure ? "; Secure" : "";
  return `${COOKIE_NAME}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_SECONDS}${secureFlag}`;
}

export function clearCookieHeader(): string {
  return `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
}

/** True when dashboard password auth is configured. */
export function isDashboardAuthEnabled(): boolean {
  return !!(process.env["FREELLM_DASHBOARD_PASSWORD"] || process.env["FREELLM_ADMIN_KEY"]);
}
