/* Subdomain parsing — Architecture §1, §5, §9.
   Wildcard *.kyveriqx.com hits one Next.js deployment;
   the subdomain decides which route segment we render. */

import { headers } from "next/headers";

export type Subdomain =
  | { kind: "marketing" }
  | { kind: "store" }
  | { kind: "tool"; slug: string };

const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "kyveriqx.com";

/** Local dev hosts that should resolve to the marketing site. */
const LOCAL_BARE_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "lvh.me",
]);

/** Read the subdomain out of a Host header value. */
export function parseHost(host: string | null): Subdomain {
  if (!host) return { kind: "marketing" };

  // strip port (":3000")
  const bare = host.split(":")[0].toLowerCase();

  // bare local host → marketing
  if (LOCAL_BARE_HOSTS.has(bare)) return { kind: "marketing" };

  // production root
  if (bare === ROOT_DOMAIN || bare === `www.${ROOT_DOMAIN}`) {
    return { kind: "marketing" };
  }

  // extract leading label
  const sub = leadingLabel(bare, ROOT_DOMAIN);
  if (!sub) return { kind: "marketing" };
  if (sub === "store") return { kind: "store" };
  return { kind: "tool", slug: sub };
}

/** Absolute URL to the main marketing site, regardless of the current
 *  subdomain. Used by the shared <Nav> so links like "Store" and the
 *  KYVERIQX brand always cross back to kyveriqx.com instead of staying
 *  on a tool subdomain (where the middleware would rewrite the path
 *  into /tools/<slug>/...). Works in prod and local dev. */
export function mainSiteUrl(path: string = "/"): string {
  const host = headers().get("host") ?? ROOT_DOMAIN;
  const bare = host.split(":")[0].toLowerCase();
  const port = host.includes(":") ? `:${host.split(":")[1]}` : "";

  if (bare === ROOT_DOMAIN || bare.endsWith(`.${ROOT_DOMAIN}`)) {
    return `https://${ROOT_DOMAIN}${path}`;
  }

  for (const local of LOCAL_BARE_HOSTS) {
    if (bare === local || bare.endsWith(`.${local}`)) {
      return `http://${local}${port}${path}`;
    }
  }

  return path;
}

/** Returns "gstledgerreco" from "gstledgerreco.kyveriqx.com"
 *  or "gstledgerreco" from "gstledgerreco.lvh.me". */
function leadingLabel(host: string, root: string): string | null {
  // production: <sub>.<root>
  if (host.endsWith(`.${root}`)) {
    return host.slice(0, -1 * (root.length + 1));
  }
  // dev: <sub>.lvh.me  /  <sub>.localhost
  for (const local of LOCAL_BARE_HOSTS) {
    if (host.endsWith(`.${local}`)) {
      return host.slice(0, -1 * (local.length + 1));
    }
  }
  return null;
}
