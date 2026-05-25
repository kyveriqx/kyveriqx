import { Nav } from "../../../core/ui/nav";
import { Card } from "../../../core/ui/card";
import { Button } from "../../../core/ui/button";

export default function Register() {
  return (
    <>
      <Nav />
      <main style={{ maxWidth: 460, margin: "0 auto", padding: "80px 24px" }}>
        <h1 style={{ fontSize: 32, fontWeight: 600, margin: "0 0 8px" }}>Create your account</h1>
        <p style={{ color: "var(--ink-300)", margin: "0 0 24px", fontSize: 14 }}>
          14-day free trial on every tool.
        </p>
        <Card style={{ padding: 24 }}>
          <form style={{ display: "grid", gap: 16 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 13, color: "var(--ink-300)" }}>Email</span>
              <input
                type="email"
                name="email"
                style={inputStyle}
                placeholder="you@company.com"
              />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 13, color: "var(--ink-300)" }}>Password</span>
              <input type="password" name="password" style={inputStyle} />
            </label>
            <Button type="submit">Start free trial</Button>
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
