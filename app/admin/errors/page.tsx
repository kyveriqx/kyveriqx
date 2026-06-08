/* Errors tab — every failed report, newest first, with the full error message.
   This is the "needs attention" surface: when a user says "the report didn't
   generate" or "the result is wrong", the failure and its message are here.
   Date window via preset chips (?range=24h|7d|30d|all, default 30 days). */

import { supabaseAdmin } from "../../../core/lib/supabase";
import { toolsById, emailsByUserId } from "../lib/data";
import { Table, Td, Pill, fmtDate } from "../components/ui";

export const dynamic = "force-dynamic";

const DAY = 24 * 60 * 60 * 1000;
const RANGES: { value: string; label: string }[] = [
  { value: "24h", label: "Last 24h" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "all", label: "All time" },
];

export default async function AdminErrors({ searchParams }: { searchParams: { range?: string } }) {
  const admin = supabaseAdmin();
  const range = RANGES.some((r) => r.value === searchParams.range) ? searchParams.range! : "30d";

  let gte: string | null = null;
  if (range === "24h") gte = new Date(Date.now() - DAY).toISOString();
  else if (range === "7d") gte = new Date(Date.now() - 7 * DAY).toISOString();
  else if (range === "30d") gte = new Date(Date.now() - 30 * DAY).toISOString();

  let q = admin
    .from("jobs")
    .select("id, user_id, tool_id, job_key, error, created_at, updated_at")
    .eq("status", "failed")
    .order("updated_at", { ascending: false })
    .limit(300);
  if (gte) q = q.gte("updated_at", gte);
  const { data: jobs } = await q;

  const tools = await toolsById();
  const emailMap = await emailsByUserId((jobs ?? []).map((j) => j.user_id as string | null));

  const chip = (label: string, value: string) => {
    const on = range === value;
    return (
      <a
        key={value}
        href={`/admin/errors?range=${value}`}
        style={{
          padding: "6px 12px",
          fontSize: 12.5,
          borderRadius: 999,
          textDecoration: "none",
          border: "1px solid var(--line-strong)",
          background: on ? "var(--accent-bg-soft)" : "var(--bg-elev)",
          color: on ? "var(--accent)" : "var(--ink-300)",
        }}
      >
        {label}
      </a>
    );
  };

  const total = (jobs ?? []).length;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Errors</h1>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 11.5, color: "var(--ink-400)", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
          When
        </span>
        {RANGES.map((r) => chip(r.label, r.value))}
      </div>

      <div style={{ fontSize: 12.5, color: total > 0 ? "var(--warn-fg)" : "var(--ink-400)" }}>
        {total} failed report{total === 1 ? "" : "s"}
        {range !== "all" ? ` · ${RANGES.find((r) => r.value === range)?.label.toLowerCase()}` : ""}
        {total >= 300 ? " · showing newest 300" : ""}
      </div>

      <Table headers={["When", "User", "Tool", "Status", "Error"]}>
        {(jobs ?? []).map((j) => {
          const tool = j.tool_id ? tools.get(j.tool_id as string) : null;
          return (
            <tr key={j.id as string}>
              <Td>{fmtDate(j.updated_at as string)}</Td>
              <Td>{j.user_id ? emailMap.get(j.user_id as string) ?? "—" : "—"}</Td>
              <Td>{tool?.name ?? String(j.job_key)}</Td>
              <Td><Pill kind="warn">failed</Pill></Td>
              <Td>
                <div
                  style={{
                    color: "var(--warn-fg)",
                    fontSize: 12,
                    fontFamily: "var(--font-mono)",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    maxHeight: 160,
                    overflowY: "auto",
                    maxWidth: 640,
                  }}
                >
                  {(j.error as string) ?? "—"}
                </div>
              </Td>
            </tr>
          );
        })}
        {total === 0 && <tr><Td>No failed reports in this window — nice.</Td></tr>}
      </Table>
    </div>
  );
}
