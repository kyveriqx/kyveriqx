import { Nav } from "../../../core/ui/nav";
import { Card } from "../../../core/ui/card";
import { Button } from "../../../core/ui/button";
import { forgotAction } from "./actions";

type Props = { searchParams: { error?: string; ok?: string } };

export default function Forgot({ searchParams }: Props) {
  const errorMsg = searchParams.error;
  const ok = searchParams.ok;

  return (
    <>
      <Nav />
      <main style={{ maxWidth: 460, margin: "0 auto", padding: "80px 24px" }}>
        <h1 style={{ fontSize: 32, fontWeight: 600, margin: "0 0 8px" }}>Reset password</h1>
        <p style={{ fontSize: 14, color: "var(--ink-400)", margin: "0 0 24px" }}>
          Enter your email and we&apos;ll send you a link to set a new password.
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
            {errorMsg === "missing" ? "Email is required." : errorMsg}
          </div>
        )}

        {ok === "sent" ? (
          <Card style={{ padding: 24 }}>
            <p style={{ margin: 0, fontSize: 15, color: "var(--ink-200)" }}>
              If an account exists for that email, a password-reset link is on its way.
              Check your inbox (and spam) and click the link to choose a new password.
            </p>
          </Card>
        ) : (
          <Card style={{ padding: 24 }}>
            <form action={forgotAction} style={{ display: "grid", gap: 16 }}>
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
              <Button type="submit">Send reset link</Button>
            </form>
          </Card>
        )}

        <p style={{ marginTop: 16, fontSize: 14, color: "var(--ink-400)" }}>
          Remembered it?{" "}
          <a href="/auth/login" style={{ color: "var(--blue-400)" }}>
            Back to log in
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
