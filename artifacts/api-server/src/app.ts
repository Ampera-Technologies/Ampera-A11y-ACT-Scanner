import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { existsSync } from "fs";
import { pool } from "@workspace/db";
import router from "./routes";
import issuesRouter, { ISSUE_ATTACHMENT_ROUTE_MARKER, ISSUE_CREATE_ROUTE_MARKER } from "./routes/issues";
import { logger } from "./lib/logger";

const PgStore = connectPgSimple(session);

const app: Express = express();
export const ISSUE_ROUTER_APP_MOUNT_MARKER = "issues-router-app-mount-v2";

// Track requests independently from server.close(): Node waits for sockets,
// but an active handler may still be doing database/browser work.
const activeRequests = new Set<Promise<void>>();
export async function waitForActiveRequests(timeoutMs: number): Promise<boolean> {
  if (activeRequests.size === 0) return true;
  const drained = Promise.all([...activeRequests].map((request) => request.catch(() => undefined)));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), Math.max(0, timeoutMs));
  });
  const result = await Promise.race([drained.then(() => true), timeout]);
  if (timer) clearTimeout(timer);
  return result;
}

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use((_req, res, next) => {
  let settled = false;
  let resolveRequest!: () => void;
  const request = new Promise<void>((resolve) => { resolveRequest = resolve; });
  activeRequests.add(request);
  const settle = () => {
    if (settled) return;
    settled = true;
    activeRequests.delete(request);
    resolveRequest();
  };
  res.once("finish", settle);
  res.once("close", settle);
  next();
});

// Trust reverse-proxy headers (Replit, Azure App Service, etc.)
// Required for secure cookies and correct IP detection behind a TLS-terminating proxy.
app.set("trust proxy", 1);

// Security headers
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-XSS-Protection", "0");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (process.env.NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
});

app.use(cors({ credentials: true, origin: true }));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days in ms
const SESSION_TTL_SEC = 7 * 24 * 60 * 60; // 7 days in seconds (for PgStore)

// Treat the session cookie as secure whenever we're behind an HTTPS-terminating
// reverse proxy.  We detect three cases:
//   1. NODE_ENV=production  — explicit production flag
//   2. WEBSITE_SITE_NAME    — Azure App Service always sets this env var
//   3. FORCE_SECURE_COOKIE  — escape hatch for other cloud environments
// In these environments sameSite must be "none" (requires secure:true) so the
// cookie is sent on every request regardless of whether the front-end and API
// share the exact same hostname (e.g. Azure Front Door / App Gateway splits).
// In local dev none of these vars are set, so we fall back to lax + non-secure.
const BEHIND_HTTPS_PROXY =
  process.env.NODE_ENV === "production" ||
  process.env.WEBSITE_SITE_NAME != null ||
  process.env.FORCE_SECURE_COOKIE === "true";

app.use(
  session({
    store: new PgStore({
      pool,
      // Explicitly match cookie maxAge so DB sessions never expire before the cookie.
      // Without this, connect-pg-simple may fall back to its 1-day default.
      ttl: SESSION_TTL_SEC,
    }),
    secret: process.env.SESSION_SECRET || "a11y-act-tool-secret-change-in-prod",
    resave: false,
    // rolling: true resets the cookie expiry on every response.
    // Without this the 7-day countdown starts at login and never resets,
    // so active users get logged out exactly 7 days after they first signed in.
    rolling: true,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: BEHIND_HTTPS_PROXY,
      // "none" allows the cookie to be sent on cross-origin requests (required when
      // the front-end and API are on different Azure hostnames).  "none" is only
      // valid when secure:true, so we fall back to "lax" in local dev.
      sameSite: BEHIND_HTTPS_PROXY ? "none" : "lax",
      maxAge: SESSION_MAX_AGE_MS,
    },
  })
);

// Issue Management is mounted directly at the application boundary. This keeps
// its routes independent of the aggregate router and makes /api/issues
// unambiguous in production deployments.
app.use("/api", (req, res, next) => {
  if (req.path === "/issues" || req.path.startsWith("/issues/")) {
    res.setHeader("X-Ampera-Issue-Router-Mount", ISSUE_ROUTER_APP_MOUNT_MARKER);
    if (req.method === "POST" && req.path === "/issues") {
      res.setHeader("X-Ampera-Issue-Route", ISSUE_CREATE_ROUTE_MARKER);
    }
    if (req.path.includes("/attachments/")) {
      res.setHeader("X-Ampera-Issue-Attachment-Route", ISSUE_ATTACHMENT_ROUTE_MARKER);
    }
  }
  next();
});
app.use("/api", issuesRouter);
app.use("/api", router);

// API requests must never fall through to the frontend (or Express's HTML
// default error page). Returning JSON keeps every client error actionable and
// makes a missing production route immediately visible.
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "API endpoint not found" });
});

// ── Serve React frontend (production only) ─────────────────────────────────
// The production build copies the Vite output into dist/public/ next to this
// bundle.  In development, the Vite dev server handles the frontend separately.
const publicDir = join(dirname(fileURLToPath(import.meta.url)), "public");
if (existsSync(publicDir)) {
  // Serve static assets (JS, CSS, images, etc.) — skip auto-serving index.html
  // so the SPA catch-all below controls which paths get it.
  app.use(express.static(publicDir, { index: false }));

  // SPA catch-all: any non-API path returns index.html so React Router can
  // handle client-side navigation (e.g. /login, /scans/123, /admin/users).
  // Express 5 uses path-to-regexp v8 which rejects bare "*" — use a regex instead.
  app.get(/.*/, (_req, res) => {
    res.sendFile(join(publicDir, "index.html"));
  });
}

export default app;
  