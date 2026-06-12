import { Nav } from "../../../core/ui/nav";
import { Card } from "../../../core/ui/card";
import { Button } from "../../../core/ui/button";
import { resetPasswordAction } from "./actions";

type Props = { searchParams: { error?: string } };

export default function Reset({ searchParams }: Props) {
  const errorMsg = searchParams.error;

  return (
    <>
      <Nav />
      <main style={{ maxWidth: 460, margin: "0 auto", padding: "80px 24px" }}>
        <h1 style={{ fontSize: 32, fontWeight: 600, margin: "0 0 8px" }}>Set a new password</h1>
        <p style={{ fontSize: 14, color: "var(--ink-400)", margin: "0 0 24px" }}>
          Choose a new password for your account.
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
            {errorMsg === "missing" ? "Both fields are required." : errorMsg}
          </div>
        )}

        <Card style={{ padding: 24 }}>
          <form action={resetPasswordAction} style={{ display: "grid", gap: 16 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 13, color: "var(--ink-300)" }}>New password</span>
              <input
                type="password"
                name="password"
                required
                minLength={6}
                autoComplete="new-password"
                style={inputStyle}
              />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 13, color: "var(--ink-300)" }}>Confirm new password</span>
              <input
                type="password"
                name="confirm"
                required
                minLength={6}
                autoComplete="new-password"
                style={inputStyle}
              />
            </label>
            <Button type="submit">Update password</Button>
          </form>
        </Card>
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
