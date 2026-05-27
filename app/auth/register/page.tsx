import { Nav } from "../../../core/ui/nav";
import { Card } from "../../../core/ui/card";
import { Button } from "../../../core/ui/button";
import { registerAction } from "./actions";

type Props = { searchParams: { error?: string; ok?: string; next?: string } };

export default function Register({ searchParams }: Props) {
  const errorMsg = searchParams.error;
  const okMsg = searchParams.ok;
  const next = searchParams.next;

  return (
    <>
      <Nav />
      <main style={{ maxWidth: 460, margin: "0 auto", padding: "80px 24px" }}>
        <h1 style={{ fontSize: 32, fontWeight: 600, margin: "0 0 8px" }}>Create your account</h1>
        <p style={{ color: "var(--ink-300)", margin: "0 0 24px", fontSize: 14 }}>
          14-day free trial on every tool.
        </p>

        {errorMsg && (
          <div
            style={{
              border: "1px solid rgba(255, 100, 100, 0.4)",
              background: "rgba(255, 80, 80, 0.08)",
              color: "#FFB3B3",
              padding: "12px 14px",
              borderRadius: 10,
              fontSize: 13,
              marginBottom: 16,
            }}
          >
            {errorMsg === "missing" ? "Email and password are required." : errorMsg}
          </div>
        )}

        {okMsg === "check-email" && (
          <div
            style={{
              border: "1px solid rgba(46,168,255,0.4)",
              background: "rgba(46,168,255,0.08)",
              color: "var(--blue-400)",
              padding: "12px 14px",
              borderRadius: 10,
              fontSize: 13,
              marginBottom: 16,
            }}
          >
            Check your email for a confirmation link, then come back and sign in.
          </div>
        )}

        <Card style={{ padding: 24 }}>
          <form action={registerAction} style={{ display: "grid", gap: 16 }}>
            {next && <input type="hidden" name="next" value={next} />}
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 13, color: "var(--ink-300)" }}>Email</span>
              <input
                type="email"
                name="email"
                required
                autoComplete="email"
                style={inputStyle}
                placeholder="you@company.com"
              />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 13, color: "var(--ink-300)" }}>Password</span>
              <input
                type="password"
                name="password"
                required
                minLength={6}
                autoComplete="new-password"
                style={inputStyle}
              />
              <span style={{ fontSize: 12, color: "var(--ink-400)" }}>Minimum 6 characters.</span>
            </label>
            <Button type="submit">Start free trial</Button>
          </form>
        </Card>

        <p style={{ marginTop: 16, fontSize: 14, color: "var(--ink-400)" }}>
          Already have an account?{" "}
          <a
            href={next ? `/auth/login?next=${encodeURIComponent(next)}` : "/auth/login"}
            style={{ color: "var(--blue-400)" }}
          >
            Log in
          </a>
        </p>
      </main>
    </>
  );
}

const inputStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.04)",
  border: "1px solid var(--line-strong)",
  borderRadius: 10,
  padding: "12px 14px",
  color: "var(--ink-100)",
  fontSize: 15,
  fontFamily: "inherit",
};
