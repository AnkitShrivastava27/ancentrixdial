import { NextRequest, NextResponse } from "next/server";

// Keep middleware focused on request-level API protections. Authentication is
// verified with Firebase Admin in the page/API handlers; checking only whether
// a cookie exists here can create redirect loops for expired or invalid cookies.
const requestCounts = new Map<string, { count: number; start: number }>();

function normalizeOrigin(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function forwardedOrigin(request: NextRequest): string | null {
  const host =
    request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ||
    request.headers.get("host")?.split(",")[0]?.trim();
  if (!host) return null;

  const forwardedProto = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();
  const protocol = forwardedProto || request.nextUrl.protocol.replace(/:$/, "");
  if (protocol !== "http" && protocol !== "https") return null;

  return normalizeOrigin(`${protocol}://${host}`);
}

export function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;

  if (path.startsWith("/api/") && path !== "/api/telnyx/webhook") {
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      "unknown";
    const windowMs = 60_000;
    const limit =
      path === "/api/auth/session"
        ? request.method === "POST"
          ? 15
          : 60
        : 120;
    const key = `${ip}:${path}`;
    const now = Date.now();
    const record = requestCounts.get(key);

    if (!record || now - record.start >= windowMs) {
      requestCounts.set(key, { count: 1, start: now });
    } else {
      record.count += 1;
      if (record.count > limit) {
        return NextResponse.json(
          { error: "Too many requests. Please try again shortly." },
          { status: 429, headers: { "Retry-After": "60" } },
        );
      }
    }
  }

  if (
    path.startsWith("/api/") &&
    ["POST", "PUT", "PATCH", "DELETE"].includes(request.method)
  ) {
    const rawOrigin = request.headers.get("origin");
    if (rawOrigin) {
      const origin = normalizeOrigin(rawOrigin);
      const allowedOrigins = new Set(
        [
          request.nextUrl.origin,
          normalizeOrigin(process.env.NEXT_PUBLIC_APP_URL),
          forwardedOrigin(request),
        ].filter((value): value is string => Boolean(value)),
      );

      if (!origin || !allowedOrigins.has(origin)) {
        return NextResponse.json(
          { error: "Cross-origin request blocked" },
          { status: 403 },
        );
      }
    }
  }

  return NextResponse.next();
}

// All protected pages and API handlers perform their own server-side session
// checks. Middleware is intentionally limited to API throttling and CSRF checks.
export const config = {
  matcher: ["/api/:path*"],
  runtime: "nodejs",
};
