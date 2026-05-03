import { Router, type IRouter } from "express";
import { createHash, timingSafeEqual } from "crypto";
import { freellmError } from "../errors/index.js";
import {
  signSession,
  parseCookieSession,
  setCookieHeader,
  clearCookieHeader,
  isDashboardAuthEnabled,
} from "../auth/session.js";

function hashKey(key: string): Buffer {
  return createHash("sha256").update(key).digest();
}

const router: IRouter = Router();

router.post("/login", (req, res, next) => {
  const password =
    process.env["FREELLM_DASHBOARD_PASSWORD"] ?? process.env["FREELLM_ADMIN_KEY"];

  if (!password) {
    // Open gateway — no password configured, treat as already authenticated
    res.json({ ok: true });
    return;
  }

  const { password: submitted } = req.body as { password?: string };

  if (!submitted || typeof submitted !== "string") {
    next(freellmError({ code: "missing_api_key", message: "password required" }));
    return;
  }

  let match: boolean;
  try {
    match = timingSafeEqual(hashKey(submitted), hashKey(password));
  } catch {
    match = false;
  }

  if (!match) {
    req.log.warn({ ip: req.ip }, "dashboard login failed: wrong password");
    next(freellmError({ code: "invalid_api_key", message: "Invalid password." }));
    return;
  }

  const sessionValue = signSession();
  req.log.info({ ip: req.ip }, "dashboard login succeeded");

  if (!sessionValue) {
    // Password set but no signing secret — session cannot be created.
    // Treat as success so the UI doesn't break; warn operator in logs.
    req.log.warn(
      "FREELLM_DASHBOARD_PASSWORD set but no signing secret found; session cookie will not work",
    );
    res.json({ ok: true });
    return;
  }

  res.setHeader("Set-Cookie", setCookieHeader(sessionValue, req.secure));
  res.json({ ok: true });
});

router.post("/logout", (_req, res) => {
  res.setHeader("Set-Cookie", clearCookieHeader());
  res.json({ ok: true });
});

router.get("/me", (req, res) => {
  if (!isDashboardAuthEnabled()) {
    // No auth configured — open gateway, always authenticated
    res.json({ authenticated: true, mode: "open" });
    return;
  }

  if (parseCookieSession(req.headers.cookie)) {
    res.json({ authenticated: true, mode: "session" });
    return;
  }

  res.status(401).json({ authenticated: false });
});

export default router;
