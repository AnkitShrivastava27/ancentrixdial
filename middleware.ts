import { NextRequest, NextResponse } from "next/server";

const publicPaths = ["/login", "/register", "/forgot-password", "/_next", "/favicon.ico", "/api/auth/session"];
const requestCounts = new Map<string, { count: number; start: number }>();
export function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (path.startsWith("/api/") && path !== "/api/telnyx/webhook") {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const windowMs = 60_000;
    const limit = path === "/api/auth/session" ? 15 : 120;
    const key = `${ip}:${path}`;
    const now = Date.now();
    const record = requestCounts.get(key);
    if (!record || now - record.start >= windowMs) requestCounts.set(key, { count: 1, start: now });
    else if (++record.count > limit) return NextResponse.json({ error: "Too many requests. Please try again shortly." }, { status: 429, headers: { "Retry-After": "60" } });
  }
  if (path.startsWith("/api/") && ["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
    const origin = request.headers.get("origin");
    if (origin && origin !== request.nextUrl.origin) return NextResponse.json({ error: "Cross-origin request blocked" }, { status: 403 });
  }
  if (publicPaths.some((entry) => path === entry || path.startsWith(`${entry}/`))) return NextResponse.next();
  const cookie = request.cookies.get(process.env.SESSION_COOKIE_NAME || "human-dialer-session");
  if (path.startsWith("/api/") || path === "/") return NextResponse.next();
  if (!cookie?.value) return NextResponse.redirect(new URL("/login", request.url));
  return NextResponse.next();
}
export const config = { matcher: ["/((?!.*\\.).*)"] };
