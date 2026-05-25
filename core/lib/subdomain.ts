/* Subdomain parsing — Architecture §1, §5, §9.
   Wildcard *.kyveriqx.com hits one Next.js deployment;
   the subdomain decides which route segment we render. */

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
