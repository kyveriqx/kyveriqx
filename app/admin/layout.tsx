/* Admin panel shell. requireAdmin() gates the whole /admin subtree (redirects
   signed-out → login, non-admins → home). Default dark theme, like marketing /
   store. The sub-nav is plain links (server component) — the active tab is not
   highlighted server-side to keep it simple; the URL is the source of truth. */

import type { ReactNode } from "react";
import { Nav } from "../../core/ui/nav";
import { requireAdmin } from "../../core/lib/admin";

export const dynamic = "force-dynamic";

const TABS: { href: string; label: string }[] = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/tools", label: "Tools" },
  { href: "/admin/activity", label: "Activity" },
  { href: "/admin/jobs", label: "Reports" },
  { href: "/admin/feedback", label: "Feedback" },
];

export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireAdmin();

  return (
    <>
      <Nav />
      <div style={{ borderBottom: "1px solid var(--line)", background: "var(--bg-base)" }}>
        <nav
          style={{
            maxWidth: 1240,
            margin: "0 auto",
            padding: "0 24px",
            display: "flex",
            gap: 4,
            flexWrap: "wrap",
          }}
        >
          {TABS.map((t) => (
            <a
              key={t.href}
              href={t.href}
              style={{
                padding: "14px 14px",
                fontSize: 14,
                color: "var(--ink-300)",
                textDecoration: "none",
                borderBottom: "2px solid transparent",
              }}
            >
              {t.label}
            </a>
          ))}
        </nav>
      </div>
      <main style={{ maxWidth: 1240, margin: "0 auto", padding: "32px 24px 80px" }}>
        {children}
      </main>
    </>
  );
}
