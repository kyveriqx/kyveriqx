/* Single-user control page. Shows the profile, a per-tool subscription matrix
   with trial/activate/cancel controls, and the user's recent reports and
   activity. Every tool is listed (even with no subscription row) so the admin
   can grant a trial or activate from scratch — the controls upsert. */

import { notFound } from "next/navigation";
import { supabaseAdmin } from "../../../../core/lib/supabase";
import { effectiveStatus } from "../../../../core/lib/entitlement";
import { loadTools, toolsById } from "../../lib/data";
import { Card, Table, Td, Pill, SectionTitle, fmtDate, fmtDay, statusKind, jobStatusKind, fmtDuration } from "../../components/ui";
import { UserActiveToggle, SubscriptionControls } from "../../components/actions-client";

export const dynamic = "force-dynamic";

export default async function AdminUserDetail({ params }: { params: { id: string } }) {
  const admin = supabaseAdmin();
  const userId = params.id;

  const { data: profile } = await admin
    .from("profiles")
    .select("id, email, full_name, is_active, created_at")
    .eq("id", userId)
    .maybeSingle();
  if (!profile) notFound();

  const tools = await loadTools();
  const toolMap = await toolsById();

  const { data: subs } = await admin
    .from("subscriptions")
    .select("tool_id, status, trial_ends_at, current_period_end")
    .eq("user_id", userId);
  const subByTool = new Map((subs ?? []).map((s) => [s.tool_id as string, s]));

  const { data: jobs } = await admin
    .from("jobs")
    .select("id, tool_id, job_key, status, error, created_at, updated_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(25);

  const { data: events } = await admin
    .from("events")
    .select("id, type, tool_id, path, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(25);

  const active = profile.is_active !== false;

  return (
    <div style={{ display: "grid", gap: 24 }}>
      <div>
        <a href="/admin/users" style={{ fontSize: 13, color: "var(--ink-300)", textDecoration: "none" }}>← All users</a>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: "8px 0 4px" }}>{String(profile.email)}</h1>
        <div style={{ fontSize: 13, color: "var(--ink-300)" }}>
          {(profile.full_name as string) || "No name"} · Joined {fmtDay(profile.created_at as string)} ·{" "}
          {active ? <Pill kind="ok">active</Pill> : <Pill kind="warn">paused</Pill>}
        </div>
        <div style={{ marginTop: 12 }}>
          <UserActiveToggle userId={userId} active={active} />
        </div>
      </div>

      <section>
        <SectionTitle>Subscriptions</SectionTitle>
        <Card style={{ padding: 0 }}>
          <Table headers={["Tool", "₹", "Status", "Trial ends", "Renews", "Controls"]}>
            {tools.map((t) => {
              const s = subByTool.get(t.id);
              const eff = s ? effectiveStatus(s.status as string, (s.trial_ends_at as string | null) ?? null) : "none";
              return (
                <tr key={t.id}>
                  <Td>{t.name}</Td>
                  <Td align="right">{t.price}</Td>
                  <Td>{eff === "none" ? <Pill kind="neutral">none</Pill> : <Pill kind={statusKind(eff)}>{eff}</Pill>}</Td>
                  <Td>{s?.trial_ends_at ? fmtDay(s.trial_ends_at as string) : "—"}</Td>
                  <Td>{s?.current_period_end ? fmtDay(s.current_period_end as string) : "—"}</Td>
                  <Td><SubscriptionControls userId={userId} toolId={t.id} /></Td>
                </tr>
              );
            })}
          </Table>
        </Card>
      </section>

      <section>
        <SectionTitle>Recent reports</SectionTitle>
        <Table headers={["When", "Tool", "Status", "Duration", "Error"]}>
          {(jobs ?? []).map((j) => {
            const tool = j.tool_id ? toolMap.get(j.tool_id as string) : null;
            const dur =
              j.status === "succeeded"
                ? (new Date(j.updated_at as string).getTime() - new Date(j.created_at as string).getTime()) / 1000
                : null;
            return (
              <tr key={j.id as string}>
                <Td>{fmtDate(j.created_at as string)}</Td>
                <Td>{tool?.name ?? String(j.job_key)}</Td>
                <Td><Pill kind={jobStatusKind(String(j.status))}>{String(j.status)}</Pill></Td>
                <Td align="right">{fmtDuration(dur)}</Td>
                <Td><span style={{ color: "var(--warn-fg)", fontSize: 12 }}>{(j.error as string) ?? ""}</span></Td>
              </tr>
            );
          })}
          {(jobs ?? []).length === 0 && <tr><Td>No reports run.</Td></tr>}
        </Table>
      </section>

      <section>
        <SectionTitle>Recent activity</SectionTitle>
        <Table headers={["When", "Event", "Tool", "Path"]}>
          {(events ?? []).map((e) => {
            const tool = e.tool_id ? toolMap.get(e.tool_id as string) : null;
            return (
              <tr key={e.id as string}>
                <Td>{fmtDate(e.created_at as string)}</Td>
                <Td><Pill kind="neutral">{String(e.type)}</Pill></Td>
                <Td>{tool?.name ?? "—"}</Td>
                <Td><span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-300)" }}>{String(e.path ?? "—")}</span></Td>
              </tr>
            );
          })}
          {(events ?? []).length === 0 && <tr><Td>No activity recorded.</Td></tr>}
        </Table>
      </section>
    </div>
  );
}
