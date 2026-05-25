/* Shared top nav. Server component so it can read the Supabase session
   and show signed-in state without a client round-trip. */

import Link from "next/link";
import { supabaseServer } from "../lib/supabase-server";

export async function Nav() {
  const supabase = supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        background: "rgba(10, 20, 34, 0.78)",
        backdropFilter: "saturate(150%) blur(14px)",
        borderBottom: "1px solid var(--line)",
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
        <Link
          href="/"
          style={{
            fontWeight: 600,
            letterSpacing: "0.04em",
            fontSize: 14,
            color: "var(--ink-100)",
          }}
        >
          KYVERIQX
        </Link>
        <nav style={{ display: "flex", gap: 4, marginLeft: "auto", alignItems: "center" }}>
          <Link
            href="/store"
            style={{
              padding: "8px 14px",
              fontSize: 14,
              color: "var(--ink-300)",
              borderRadius: 999,
            }}
          >
            Store
          </Link>
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
              href="/auth/login"
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
