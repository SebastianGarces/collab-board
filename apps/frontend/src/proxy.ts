import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

async function isAuthenticated(request: NextRequest): Promise<boolean> {
  try {
    const response = await fetch(`${API_URL}/api/me`, {
      headers: { cookie: request.headers.get("cookie") ?? "" },
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Protect /canvas/* routes -- redirect to /login if not authenticated
  if (pathname.startsWith("/canvas")) {
    const authed = await isAuthenticated(request);
    if (!authed) {
      return NextResponse.redirect(new URL("/login", request.url));
    }
  }

  // Redirect /login to /canvas/main if already authenticated
  if (pathname === "/login") {
    const authed = await isAuthenticated(request);
    if (authed) {
      return NextResponse.redirect(new URL("/canvas/main", request.url));
    }
  }

  return NextResponse.next();
}

export const proxyConfig = {
  matcher: ["/canvas/:path*", "/login"],
};
