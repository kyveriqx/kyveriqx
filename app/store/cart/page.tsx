import { Nav } from "../../../core/ui/nav";

// Nav reads the auth cookie via the Supabase server client, so this page
// can never be statically prerendered. Declare it explicitly so Next.js
// skips the static-render probe (which would emit a "Dynamic server
// usage: cookies" warning during build).
export const dynamic = "force-dynamic";

export default function Cart() {
  return (
    <>
      <Nav />
      <main style={{ maxWidth: 1240, margin: "0 auto", padding: "80px 24px" }}>
        <h1 style={{ fontSize: 40, fontWeight: 600 }}>Your cart</h1>
        <p style={{ color: "var(--ink-300)" }}>
          Cart is empty. Browse the <a href="/" style={{ color: "var(--blue-400)" }}>store</a>.
        </p>
      </main>
    </>
  );
}
