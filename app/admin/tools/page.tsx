/* Per-tool breakdown: how many users are subscribed (paid) / on trial /
   expired / never-subscribed, alongside report volume, average run time, and
   failure rate. Subscription status is computed with the same effectiveStatus()
   used to gate access, so a lapsed trial counts as expired here too. */

import { supabaseAdmin } from "../../../core/lib/supabase";
import { loadTools, countRows } from "../lib/data";
import { effectiveStatus } from "../../../core/lib/entitlement";
import { StatTile, Table, Td, Pill, SectionTitle, fmtDuration } from "../components/ui";

export const dynamic = "force-dynamic";

type ToolStats = {
  active: number;
  trial: number;
  expired: number;
  subscribedUsers: Set<string>;
  reports: number;
  failed: number;
  durations: number[];
  errors: Map<string, number>;
};

export default async function AdminTools() {
  const admin = supabaseAdmin();
  const tools = await loadTools();
  const totalUsers = await countRows("profiles");

  const stats = new Map<string, ToolStats>();
  for (const t of tools) {
    stats.set(t.id, { active: 0, trial: 0, expired: 0, subscribedUsers: new Set(), reports: 0, failed: 0, durations: [], errors: new Map() });
  }

  // Subscriptions → status mix per tool.
  const { data: subs } = await admin
    .from("subscriptions")
    .select("tool_id, user_id, status, trial_ends_at")
    .limit(10000);
  for (const s of subs ?? []) {
    const st = stats.get(s.tool_id as string);
    if (!st) continue;
    st.subscribedUsers.add(s.user_id as string);
    const eff = effectiveStatus(s.status as string, (s.trial_ends_at as string | null) ?? null);
    if (eff === "active") st.active += 1;
    else if (eff === "trial") st.trial += 1;
    else st.expired += 1; // expired | cancelled
  }

  // Jobs → report volume, durations, failures, errors per tool.
  const { data: jobs } = await admin
    .from("jobs")
    .select("tool_id, status, created_at, updated_at, error")
    .limit(20000);
  for (const j of jobs ?? []) {
    const st = stats.get(j.tool_id as string);
    if (!st) continue;
    st.reports += 1;
    if (j.status === "failed") {
      st.failed += 1;
      const key = (j.error as string | null)?.trim() || "(no message)";
      st.errors.set(key, (st.errors.get(key) ?? 0) + 1);
    }
    if (j.status === "succeeded") {
      const d = (new Date(j.updated_at as string).getTime() - new Date(j.created_at as string).getTime()) / 1000;
      if (Number.isFinite(d) && d >= 0) st.durations.push(d);
    }
  }

  return (
    <div style={{ display: "grid", gap: 24 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Tools</h1>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 14 }}>
        <StatTile label="Tools in catalogue" value={tools.length} />
        <StatTile label="Total users" value={totalUsers} />
      </div>

      <section>
        <SectionTitle>Subscription mix &amp; reliability</SectionTitle>
        <Table headers={["Tool", "₹", "Paid", "Trial", "Expired", "Not subscribed", "Reports", "Avg time", "Failure rate"]}>
          {tools.map((t) => {
            const st = stats.get(t.id)!;
            const notSubscribed = Math.max(0, totalUsers - st.subscribedUsers.size);
            const avg = st.durations.length ? st.durations.reduce((a, b) => a + b, 0) / st.durations.length : null;
            const failRate = st.reports > 0 ? (st.failed / st.reports) * 100 : 0;
            return (
              <tr key={t.id}>
                <Td>{t.name}</Td>
                <Td align="right">{t.price}</Td>
                <Td align="right"><Pill kind="ok">{st.active}</Pill></Td>
                <Td align="right"><Pill kind="amber">{st.trial}</Pill></Td>
                <Td align="right"><Pill kind="warn">{st.expired}</Pill></Td>
                <Td align="right">{notSubscribed}</Td>
                <Td align="right">{st.reports}</Td>
                <Td align="right">{fmtDuration(avg)}</Td>
                <Td align="right">
                  <span style={{ color: failRate > 10 ? "var(--warn-fg)" : "var(--ink-200)" }}>
                    {failRate.toFixed(0)}%
                  </span>
                </Td>
              </tr>
            );
          })}
        </Table>
      </section>

      <section>
        <SectionTitle>Top errors by tool</SectionTitle>
        <Table headers={["Tool", "Error", "Count"]}>
          {tools.flatMap((t) => {
            const st = stats.get(t.id)!;
            const top = Array.from(st.errors.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3);
            return top.map(([err, cnt], i) => (
              <tr key={`${t.id}-${i}`}>
                <Td>{i === 0 ? t.name : ""}</Td>
                <Td><span style={{ color: "var(--warn-fg)", fontSize: 12 }}>{err}</span></Td>
                <Td align="right">{cnt}</Td>
              </tr>
            ));
          })}
          {tools.every((t) => stats.get(t.id)!.errors.size === 0) && (
            <tr><Td>No report errors recorded.</Td></tr>
          )}
        </Table>
      </section>
    </div>
  );
}
