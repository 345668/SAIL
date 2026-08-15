import { NextResponse, type NextRequest } from "next/server"
import { SESSION_COOKIE } from "./lib/constants"

/**
 * Edge-safe first gate: redirect anyone without a session cookie to /login.
 * This is a coarse presence check only (no crypto in Edge) — the (portal)
 * layout re-verifies the signature + expiry server-side in the Node runtime.
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  const hasCookie = !!req.cookies.get(SESSION_COOKIE)?.value

  const isPublic =
    pathname === "/login" ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico"

  if (!hasCookie && !isPublic) {
    const url = req.nextUrl.clone()
    url.pathname = "/login"
    url.searchParams.set("next", pathname)
    return NextResponse.redirect(url)
  }
  // Signed-in users shouldn't sit on /login.
  if (hasCookie && pathname === "/login") {
    const url = req.nextUrl.clone()
    url.pathname = "/"
    url.search = ""
    return NextResponse.redirect(url)
  }
  return NextResponse.next()
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
}
