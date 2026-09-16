import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "botlings_session";

/** Optimistic check only — real session validation happens on the server for every request. */
export function proxy(request: NextRequest) {
  const hasSession = request.cookies.has(SESSION_COOKIE);
  const { pathname } = request.nextUrl;

  if (!hasSession && pathname !== "/login") {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    // Everything except Next internals and public PWA assets.
    "/((?!_next/|sw\\.js|manifest\\.webmanifest|icon\\.svg|apple-icon|pwa-icon/|favicon).*)",
  ],
};
