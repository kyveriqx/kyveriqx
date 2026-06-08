/* Admin overview — the at-a-glance numbers. Users, subscription mix, report
   volume + reliability over the last 7 days, plus a recent-activity feed.
   Failed reports live on their own Errors tab (/admin/errors). Report
   runs/errors come from `jobs`; visits/views/downloads from `events`. */

import { supabaseAdmin } from "../../core/lib/supabase";
import { countRows, toolsById, emailsByUserId } from "./lib/data";
import { StatTile, Table, Td, Pill, SectionTitle, fmtDate, fmtDuration } from "./components/ui";

export const dynamic = "force-dynamic";

const DAY = 24 * 60 * 60 * 1000;

export default async function AdminOverview() {
  const admin = supabaseAdmin();
  const now = Date.now();
  const weekAgo = new Date(now - 7 * DAY).toISOString();
  const soon = new Date(now + 3 * DAY).toISOString();
  const nowIso = new Date(now).toISOString();

  const [
    totalUsers,
    newUsers,
    activeSubs,
    trialsActive,
    trialsExpiring,
    reports7d,
    failed7d,
    openFeedback,
  ] = await Promise.all([
    countRows("profiles"),
    countRows("profiles", (q) => q.gte("created_at", weekAgo)),
    countRows("subscriptions", (q) => q.eq("status", "active")),
    countRows("subscriptions", (q) => q.eq("status", "trial").gt("trial_ends_at", nowIso)),
    countRows("subscriptions", (q) => q.eq("status", "trial").gt("trial_ends_at", nowIso).lte("trial_ends_at", soon)),
    countRows("jobs", (q) => q.gte("created_at", weekAgo)),
    countRows("jobs", (q) => q.gte("created_at", weekAgo).eq("status", "failed")),
    countRows("feedback", (q) => q.eq("status", "open")),
  ]);

  const failureRate = reports7d > 0 ? (failed7d / reports7d) * 100 : 0;

  // Avg duration over recent succeeded jobs (computed in JS — no SQL agg via JS client).
  const { data: succeeded } = await admin
    .from("jobs")
    .select("created_at, updated_at")
    .eq("status", "succeeded")
    .order("updated_at", { ascending: false })
    .limit(200);
  const durations = (succeeded ?? [])
    .map((j) => (new Date(j.updated_at as string).getTime() - new Date(j.created_at as string).getTime()) / 1000)
    .filter((s) => Number.isFinite(s) && s >= 0);
  const avgDuration = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null;

  // Recent activity feed.
  const { data: events } = await admin
    .from("events")
    .select("id, type, user_id, tool_id, path, created_at")
    .order("created_at", { ascending: false })
    .limit(15);
  const tools = await toolsById();
  const emailMap = await emailsByUserId((events ?? []).map((e) => e.user_id as string | null));

  return (
    <div style={{ display: "grid", gap: 28 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Overview</h1>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 14 }}>
        <StatTile label="Total users" value={totalUsers} sub={`${newUsers} new this week`} />
        <StatTile label="Active subscriptions" value={activeSubs} tone="ok" />
        <StatTile label="Trials active" value={trialsActive} tone="amber" sub={`${trialsExpiring} expiring ≤3 days`} />
        <StatTile label="Reports (7d)" value={reports7d} />
        <StatTile
          label="Failure rate (7d)"
          value={`${failureRate.toFixed(0)}%`}
          tone={failureRate > 10 ? "warn" : "neutral"}
          sub={`${failed7d} failed`}
        />
        <StatTile label="Avg report time" value={fmtDuration(avgDuration)} sub="last 200 succeeded" />
        <StatTile label="Open feedback" value={openFeedback} tone={openFeedback > 0 ? "amber" : "ok"} />
      </div>

      <section>
        <SectionTitle>Recent activity</SectionTitle>
        <Table headers={["When", "User", "Event", "Tool", "Path"]}>
          {(events ?? []).map((e) => {
            const tool = e.tool_id ? tools.get(e.tool_id as string) : null;
            return (
              <tr key={e.id as string}>
                <Td>{fmtDate(e.created_at as string)}</Td>
                <Td>{e.user_id ? emailMap.get(e.user_id as string) ?? "—" : "anon"}</Td>
                <Td><Pill kind="neutral">{String(e.type)}</Pill></Td>
                <Td>{tool?.name ?? "—"}</Td>
                <Td><span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-300)" }}>{String(e.path ?? "—")}</span></Td>
              </tr>
            );
          })}
          {(events ?? []).length === 0 && (
            <tr><Td>No activity recorded yet.</Td></tr>
          )}
        </Table>
      </section>
    </div>
  );
}
