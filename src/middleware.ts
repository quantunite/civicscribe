// Single-user auth gate. When APP_PASSWORD is set, every request must carry a
// valid session cookie; otherwise the middleware is a no-op so local mock-mode
// dev and the test suites run without configuration.
//
// Exempt paths (always reachable):
//   /login, /api/auth/*   — the sign-in flow itself
//   /api/health           — platform health checks
//   /api/jobs/tick        — the worker/cron; guarded by CRON_SECRET instead
//   /api/webhooks/*        — third-party callbacks; validate their own payloads

import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, isAuthEnabled, verifySessionToken } from "@/lib/auth";

const PUBLIC_PREFIXES = [
  "/login",
  "/api/auth",
  "/api/health",
  "/api/jobs/tick",
  "/api/webhooks",
];

export async function middleware(req: NextRequest): Promise<NextResponse> {
  if (!isAuthEnabled()) {
    return NextResponse.next();
  }

  const { pathname } = req.nextUrl;
  if (PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return NextResponse.next();
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (await verifySessionToken(token)) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  loginUrl.searchParams.set("next", pathname + req.nextUrl.search);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Run on everything except Next internals and static asset files.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt)$).*)",
  ],
};
