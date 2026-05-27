/* Shared top nav. Server component so it can read the Supabase session
   and show signed-in state without a client round-trip. */

import Link from "next/link";
import { supabaseServer } from "../lib/supabase-server";
import { mainSiteUrl, loginHrefWithReturn } from "../lib/subdomain";

export async function Nav() {
  let user: { email?: string | null } | null = null;
  try {
    const supabase = supabaseServer();
    const res = await supabase.auth.getUser();
    user = res.data.user;
  } catch (err) {
    // Fail open: render the page with a Login link if we can't resolve the
    // session (e.g. env vars missing on a freshly deployed environment).
    console.error("Nav: failed to resolve session", err);
  }

  return (
    <header
      data-theme="dark"
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        background: "#1A2F55",
        borderBottom: "1px solid rgba(255, 255, 255, 0.10)",
        color: "var(--ink-100)",
      }}
    >
      <div
        style={{
          maxWidth: 1240,
          margin: "0 auto",
          padding: "14px 24px",
          display: "flex",
          alignItems: "center",
          gap: 18,
        }}
      >
        <a
          href={mainSiteUrl("/")}
          style={{
            fontWeight: 600,
            letterSpacing: "0.04em",
            fontSize: 14,
            color: "var(--ink-100)",
            textDecoration: "none",
          }}
        >
          KYVERIQX
        </a>
        <nav style={{ display: "flex", gap: 4, marginLeft: "auto", alignItems: "center" }}>
          <a
            href={mainSiteUrl("/store")}
            style={{
              padding: "8px 14px",
              fontSize: 14,
              color: "var(--ink-300)",
              borderRadius: 999,
              textDecoration: "none",
            }}
          >
            Store
          </a>
          {user ? (
            <>
              <span
                style={{
                  padding: "8px 12px",
                  fontSize: 13,
                  color: "var(--ink-300)",
                  fontFamily: "var(--font-mono)",
                }}
              >
                {user.email}
              </span>
              <form action="/auth/signout" method="post" style={{ margin: 0 }}>
                <button
                  type="submit"
                  style={{
                    padding: "8px 14px",
                    fontSize: 14,
                    color: "var(--ink-300)",
                    borderRadius: 999,
                    cursor: "pointer",
                  }}
                >
                  Sign out
                </button>
              </form>
            </>
          ) : (
            <Link
              href={loginHrefWithReturn()}
              style={{
                padding: "8px 14px",
                fontSize: 14,
                color: "var(--ink-300)",
                borderRadius: 999,
              }}
            >
              Login
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
