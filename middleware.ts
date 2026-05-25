/* Subdomain router — Architecture §1, §5, §9.
   One Next.js app behind wildcard *.kyveriqx.com.
   Rewrites incoming URLs based on the Host header so each
   subdomain renders the right route segment under /app. */

import { NextResponse, type NextRequest } from "next/server";
import { parseHost } from "./core/lib/subdomain";

export function middleware(req: NextRequest) {
  const host = req.headers.get("host");
  const sub = parseHost(host);
  const url = req.nextUrl.clone();
  const path = url.pathname;

  switch (sub.kind) {
    case "marketing":
      // kyveriqx.com / www.kyveriqx.com — serve /app/(marketing) routes as-is.
      // Anything already prefixed with /tools or /store on the bare domain is
      // an internal rewrite target; let it pass through.
      return NextResponse.next();

    case "store":
      // store.kyveriqx.com → /app/store/*
      if (!path.startsWith("/store")) {
        url.pathname = `/store${path === "/" ? "" : path}`;
        return NextResponse.rewrite(url);
      }
      return NextResponse.next();

    case "tool": {
      // <sub>.kyveriqx.com → /app/tools/<sub>/*
      // The page itself will validate the slug against the `tools` table.
      const prefix = `/tools/${sub.slug}`;
      if (!path.startsWith(prefix)) {
        url.pathname = `${prefix}${path === "/" ? "" : path}`;
        return NextResponse.rewrite(url);
      }
      return NextResponse.next();
    }
  }
}

export const config = {
  // Skip static assets, /_next, /api, and files with extensions.
  matcher: ["/((?!_next/|favicon.ico|api/|.*\\..*).*)"],
};
