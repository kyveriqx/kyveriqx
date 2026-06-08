/* User directory. One row per profile with signup date, last seen (newest
   event), lifetime report count, and how many paid subscriptions they hold.
   Aggregates are computed from bulk fetches (not per-user queries) to keep the
   page to a handful of round-trips. Click a row to manage that user. */

import { supabaseAdmin } from "../../../core/lib/supabase";
import { effectiveStatus } from "../../../core/lib/entitlement";
import { Table, Td, Pill, fmtDay, fmtDate } from "../components/ui";
import { UserActiveToggle } from "../components/actions-client";

export const dynamic = "force-dynamic";

export default async function AdminUsers() {
  const admin = supabaseAdmin();

  const { data: profiles } = await admin
    .from("profiles")
    .select("id, email, full_name, is_active, created_at")
    .order("created_at", { ascending: false })
    .limit(500);

  const { data: jobs } = await admin.from("jobs").select("user_id").limit(50000);
  const reportCount = new Map<string, number>();
  for (const j of jobs ?? []) {
    const u = j.user_id as string;
    reportCount.set(u, (reportCount.get(u) ?? 0) + 1);
  }

  const { data: subs } = await admin
    .from("subscriptions")
    .select("user_id, status, trial_ends_at")
    .limit(20000);
  const activeSubs = new Map<string, number>();
  for (const s of subs ?? []) {
    const eff = effectiveStatus(s.status as string, (s.trial_ends_at as string | null) ?? null);
    if (eff === "active") {
      const u = s.user_id as string;
      activeSubs.set(u, (activeSubs.get(u) ?? 0) + 1);
    }
  }

  const { data: events } = await admin
    .from("events")
    .select("user_id, created_at")
    .order("created_at", { ascending: false })
    .limit(10000);
  const lastSeen = new Map<string, string>();
  for (const e of events ?? []) {
    const u = e.user_id as string | null;
    if (u && !lastSeen.has(u)) lastSeen.set(u, e.created_at as string);
  }

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Users</h1>
      <Table headers={["Email", "Name", "Joined", "Last seen", "Reports", "Paid tools", "Status", "Action"]}>
        {(profiles ?? []).map((p) => {
          const id = p.id as string;
          const active = p.is_active !== false;
          return (
            <tr key={id}>
              <Td>
                <a href={`/admin/users/${id}`} style={{ color: "var(--accent)", textDecoration: "none", fontWeight: 600 }}>
                  {String(p.email)}
                </a>
              </Td>
              <Td>{(p.full_name as string) || "—"}</Td>
              <Td>{fmtDay(p.created_at as string)}</Td>
              <Td>{lastSeen.has(id) ? fmtDate(lastSeen.get(id)!) : "—"}</Td>
              <Td align="right">{reportCount.get(id) ?? 0}</Td>
              <Td align="right">{activeSubs.get(id) ?? 0}</Td>
              <Td>{active ? <Pill kind="ok">active</Pill> : <Pill kind="warn">paused</Pill>}</Td>
              <Td><UserActiveToggle userId={id} active={active} /></Td>
            </tr>
          );
        })}
        {(profiles ?? []).length === 0 && <tr><Td>No users yet.</Td></tr>}
      </Table>
    </div>
  );
}
