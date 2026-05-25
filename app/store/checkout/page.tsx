import { Nav } from "../../../core/ui/nav";

export default function Checkout() {
  return (
    <>
      <Nav />
      <main style={{ maxWidth: 1240, margin: "0 auto", padding: "80px 24px" }}>
        <h1 style={{ fontSize: 40, fontWeight: 600 }}>Checkout</h1>
        <p style={{ color: "var(--ink-300)" }}>
          Razorpay checkout opens here once Step 6 is wired up. Test-mode keys
          come from <code>RAZORPAY_KEY_ID</code> / <code>RAZORPAY_KEY_SECRET</code>.
        </p>
      </main>
    </>
  );
}
