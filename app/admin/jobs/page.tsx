/* Every report run, newest first. Filter by status via ?status=… — use
   status=failed to triage "the report didn't generate / wrong result." Duration
   is updated_at − created_at for finished jobs. */

import { supabaseAdmin } from "../../../core/lib/supabase";
import { toolsById, emailsByUserId } from "../lib/data";
import { Table, Td, Pill, fmtDate, fmtDuration, jobStatusKind } from "../components/ui";

export const dynamic = "force-dynamic";

const STATUSES = ["queued", "running", "succeeded", "failed", "cancelled"];

export default async function AdminJobs({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  const admin = supabaseAdmin();
  const statusFilter = searchParams.status && STATUSES.includes(searchParams.status) ? searchParams.status : null;

  let q = admin
    .from("jobs")
    .select("id, user_id, tool_id, job_key, status, error, created_at, updated_at")
    .order("created_at", { ascending: false })
    .limit(300);
  if (statusFilter) q = q.eq("status", statusFilter);
  const { data: jobs } = await q;

  const tools = await toolsById();
  const emailMap = await emailsByUserId((jobs ?? []).map((j) => j.user_id as string | null));

  const chip = (label: string, value: string | null) => {
    const activeChip = (value ?? null) === statusFilter;
    const href = value ? `/admin/jobs?status=${value}` : "/admin/jobs";
    return (
      <a
        key={label}
        href={href}
        style={{
          padding: "6px 12px",
          fontSize: 12.5,
          borderRadius: 999,
          textDecoration: "none",
          border: "1px solid var(--line-strong)",
          background: activeChip ? "var(--accent-bg-soft)" : "var(--bg-elev)",
          color: activeChip ? "var(--accent)" : "var(--ink-300)",
        }}
      >
        {label}
      </a>
    );
  };

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Reports</h1>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {chip("All", null)}
        {STATUSES.map((s) => chip(s, s))}
      </div>

      <Table headers={["When", "User", "Tool", "Status", "Duration", "Error"]}>
        {(jobs ?? []).map((j) => {
          const tool = j.tool_id ? tools.get(j.tool_id as string) : null;
          const dur =
            j.status === "succeeded"
              ? (new Date(j.updated_at as string).getTime() - new Date(j.created_at as string).getTime()) / 1000
              : null;
          return (
            <tr key={j.id as string}>
              <Td>{fmtDate(j.created_at as string)}</Td>
              <Td>{j.user_id ? emailMap.get(j.user_id as string) ?? "—" : "—"}</Td>
              <Td>{tool?.name ?? String(j.job_key)}</Td>
              <Td><Pill kind={jobStatusKind(String(j.status))}>{String(j.status)}</Pill></Td>
              <Td align="right">{fmtDuration(dur)}</Td>
              <Td><span style={{ color: "var(--warn-fg)", fontSize: 12 }}>{(j.error as string) ?? ""}</span></Td>
            </tr>
          );
        })}
        {(jobs ?? []).length === 0 && <tr><Td>No reports for this filter.</Td></tr>}
      </Table>
    </div>
  );
}
