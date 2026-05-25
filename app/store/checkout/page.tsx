/* Billing page — one row per tool with its trial/subscription state and a
   Subscribe button that opens Razorpay Checkout (Architecture §8.6). */

import { redirect } from "next/navigation";
import { Nav } from "../../../core/ui/nav";
import { Card } from "../../../core/ui/card";
import { SubscribeButton } from "../../../core/ui/subscribe-button";
import { supabaseServer } from "../../../core/lib/supabase-server";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  slug: string;
  name: string;
  price: number;
  status: "trial" | "active" | "expired" | "cancelled";
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
};

function badge(status: Row["status"]): { label: string; bg: string; fg: string } {
  switch (status) {
    case "active":    return { label: "Active",    bg: "rgba(78,222,128,0.12)", fg: "#7BE39A" };
    case "trial":     return { label: "On trial",  bg: "rgba(46,168,255,0.12)", fg: "#7CC4FF" };
    case "cancelled": return { label: "Cancelled", bg: "rgba(255,193,128,0.12)", fg: "#FFC180" };
    case "expired":   return { label: "Expired",   bg: "rgba(255,128,128,0.12)", fg: "#FF9A9A" };
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

export default async function Checkout() {
  const supabase = supabaseServer();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login?next=/store/checkout");

  const { data, error } = await supabase
    .from("subscriptions")
    .select(`
      id,
      status,
      trial_ends_at,
      current_period_end,
      tool:tools ( slug, name, price )
    `)
    .eq("user_id", user.id);
  if (error) throw new Error(`subscriptions read failed: ${error.message}`);

  const rows: Row[] = (data ?? [])
    .filter((r) => r.tool)
    .map((r) => {
      const tool = r.tool as unknown as { slug: string; name: string; price: number };
      return {
        id: r.id as string,
        slug: tool.slug,
        name: tool.name,
        price: Number(tool.price),
        status: r.status as Row["status"],
        trialEndsAt: (r.trial_ends_at as string | null) ?? null,
        currentPeriodEnd: (r.current_period_end as string | null) ?? null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      <Nav />
      <main style={{ maxWidth: 1240, margin: "0 auto", padding: "80px 24px" }}>
        <h1 style={{ fontSize: 40, fontWeight: 600, margin: "0 0 8px" }}>Billing</h1>
        <p style={{ color: "var(--ink-300)", margin: "0 0 32px" }}>
          One subscription per tool, billed monthly in INR via Razorpay.
        </p>

        <div style={{ display: "grid", gap: 16 }}>
          {rows.map((row) => {
            const b = badge(row.status);
            const showSubscribe = row.status === "trial" || row.status === "expired" || row.status === "cancelled";
            const renewLabel =
              row.status === "active"
                ? `Renews ${formatDate(row.currentPeriodEnd)}`
                : row.status === "trial"
                ? `Trial ends ${formatDate(row.trialEndsAt)}`
                : "—";

            return (
              <Card key={row.id} style={{ padding: 24 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 24, flexWrap: "wrap" }}>
                  <div style={{ display: "grid", gap: 6 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>{row.name}</h2>
                      <span
                        style={{
                          fontSize: 12, padding: "4px 10px", borderRadius: 999,
                          background: b.bg, color: b.fg, fontWeight: 500,
                        }}
                      >
                        {b.label}
                      </span>
                    </div>
                    <span style={{ color: "var(--ink-300)", fontSize: 14 }}>
                      ₹{row.price}/month · {renewLabel}
                    </span>
                  </div>

                  {showSubscribe ? (
                    <SubscribeButton
                      toolSlug={row.slug}
                      userEmail={user.email ?? undefined}
                      label={row.status === "trial" ? "Subscribe" : "Reactivate"}
                    />
                  ) : (
                    <span style={{ color: "var(--ink-400)", fontSize: 13 }}>
                      Managed in Razorpay
                    </span>
                  )}
                </div>
              </Card>
            );
          })}

          {rows.length === 0 && (
            <Card style={{ padding: 24 }}>
              <p style={{ color: "var(--ink-300)", margin: 0 }}>
                No subscriptions found. Trials are created automatically on signup —
                if you're seeing this, check the <code>handle_new_user</code> trigger.
              </p>
            </Card>
          )}
        </div>
      </main>
    </>
  );
}
