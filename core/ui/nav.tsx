/* Shared top nav — minimal, used by marketing + store + tool layouts.
   The fancy animated pill nav from the HTML ref is intentionally not
   imported (it's a visual/structural decision, not a build artifact). */

import Link from "next/link";

export function Nav() {
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
        <nav style={{ display: "flex", gap: 4, marginLeft: "auto" }}>
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
        </nav>
      </div>
    </header>
  );
}
