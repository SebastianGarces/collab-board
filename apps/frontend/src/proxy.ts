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
  const { pathname, search } = request.nextUrl;

  // Protect /canvas/* routes -- redirect to /login with callback if unauthenticated
  if (pathname.startsWith("/canvas")) {
    const authed = await isAuthenticated(request);
    if (!authed) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("cb", `${pathname}${search}`);
      return NextResponse.redirect(loginUrl);
    }
  }

  // Redirect /login to callback (if provided) when already authenticated
  if (pathname === "/login") {
    const authed = await isAuthenticated(request);
    if (authed) {
      const cb = request.nextUrl.searchParams.get("cb");
      const destination = cb && cb.startsWith("/") ? cb : "/dashboard";
      return NextResponse.redirect(new URL(destination, request.url));
    }
  }

  return NextResponse.next();
}

export const proxyConfig = {
  matcher: ["/canvas/:path*", "/login"],
};
