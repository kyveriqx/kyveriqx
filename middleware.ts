/* Subdomain router — Architecture §1, §5, §9.
   One Next.js app behind wildcard *.kyveriqx.com.
   Rewrites incoming URLs based on the Host header so each
   subdomain renders the right route segment under /app. */

import { NextResponse, type NextRequest } from "next/server";
import { parseHost } from "./core/lib/subdomain";

/** Paths that are global to all subdomains: auth, api routes, and shared
 *  pages should NEVER get rewritten into a tool/store namespace. */
const SHARED_PATH_PREFIXES = ["/auth", "/api"];

function isSharedPath(path: string): boolean {
  return SHARED_PATH_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

export function middleware(req: NextRequest) {
  const host = req.headers.get("host");
  const sub = parseHost(host);
  const url = req.nextUrl.clone();
  const path = url.pathname;

  // Expose the originating pathname to server components/actions so they
  // can build `?next=<currentPath>` for the auth flow without each page
  // having to thread it down as a prop. Read via `headers().get("x-pathname")`.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-pathname", path);

  // Shared routes pass through unchanged regardless of which subdomain
  // the user is on, so /auth/login works on every subdomain.
  if (isSharedPath(path)) {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  switch (sub.kind) {
    case "marketing":
      return NextResponse.next({ request: { headers: requestHeaders } });

    case "store":
      if (!path.startsWith("/store")) {
        url.pathname = `/store${path === "/" ? "" : path}`;
        return NextResponse.rewrite(url, { request: { headers: requestHeaders } });
      }
      return NextResponse.next({ request: { headers: requestHeaders } });

    case "tool": {
      // Tell server components which tool this request resolved to, so the
      // shared /tools layout can enforce entitlement without re-parsing host.
      requestHeaders.set("x-tool-slug", sub.slug);
      const prefix = `/tools/${sub.slug}`;
      if (!path.startsWith(prefix)) {
        url.pathname = `${prefix}${path === "/" ? "" : path}`;
        return NextResponse.rewrite(url, { request: { headers: requestHeaders } });
      }
      return NextResponse.next({ request: { headers: requestHeaders } });
    }
  }
}

export const config = {
  // Skip static assets, /_next, /api (handled by Next routing), and files with extensions.
  matcher: ["/((?!_next/|favicon.ico|api/|.*\\..*).*)"],
};
