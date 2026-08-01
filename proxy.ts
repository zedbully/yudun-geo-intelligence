import { NextRequest, NextResponse } from "next/server";

/**
 * Optional deployment-wide Basic Auth plus best-effort IP rate limiting for
 * /api/* routes (Next.js 16 "proxy", formerly middleware).
 *
 * Basic Auth is inactive until both YUDUN_BASIC_AUTH_* values are configured.
 * The rate limiter is in-memory (per instance on serverless), so it stops
 * bursts rather than a determined distributed attacker.
 */

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

// Per-path budgets (requests per window). The expensive pipelines get tighter caps.
const LIMITS: Record<string, { limit: number; windowMs: number }> = {
  "/api/bulk-sro": { limit: 4, windowMs: 60_000 },
  "/api/scrape": { limit: 20, windowMs: 60_000 },
  "/api/brightdata-platforms": { limit: 12, windowMs: 60_000 },
  "/api/sro-analyze": { limit: 20, windowMs: 60_000 },
};
const DEFAULT_LIMIT = { limit: 30, windowMs: 60_000 };

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

function safeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

function basicAuthResponse(path: string) {
  const headers = { "WWW-Authenticate": 'Basic realm="Yudun GEO"' };
  return path.startsWith("/api/")
    ? NextResponse.json({ error: "Unauthorized" }, { status: 401, headers })
    : new NextResponse("Authentication required", { status: 401, headers });
}

export function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const authUser = process.env.YUDUN_BASIC_AUTH_USER;
  const authPassword = process.env.YUDUN_BASIC_AUTH_PASSWORD;

  const hasRouteLevelAuth = path === "/api/geoflow/export";
  if ((authUser || authPassword) && !hasRouteLevelAuth) {
    if (!authUser || !authPassword) {
      return NextResponse.json(
        { error: "Basic Auth is partially configured" },
        { status: 503 },
      );
    }
    const header = req.headers.get("authorization");
    let suppliedUser = "";
    let suppliedPassword = "";
    if (header?.startsWith("Basic ")) {
      try {
        const decoded = atob(header.slice(6));
        const separator = decoded.indexOf(":");
        suppliedUser = separator >= 0 ? decoded.slice(0, separator) : "";
        suppliedPassword = separator >= 0 ? decoded.slice(separator + 1) : "";
      } catch {
        // Invalid Basic credentials are handled below.
      }
    }
    if (!safeEqual(suppliedUser, authUser) || !safeEqual(suppliedPassword, authPassword)) {
      return basicAuthResponse(path);
    }
  }

  if (!path.startsWith("/api/")) return NextResponse.next();
  const rule = LIMITS[path] ?? DEFAULT_LIMIT;

  const ip = (
    req.headers.get("x-forwarded-for")?.split(",")[0] ??
    req.headers.get("x-real-ip") ??
    "unknown"
  ).trim();
  const key = `${ip}:${path}`;
  const now = Date.now();

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + rule.windowMs });
    // Opportunistic cleanup so the map can't grow without bound.
    if (buckets.size > 10_000) {
      for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
    }
    return NextResponse.next();
  }

  if (bucket.count >= rule.limit) {
    const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
    return NextResponse.json(
      { error: "Rate limit exceeded. Try again later." },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  bucket.count += 1;
  return NextResponse.next();
}
