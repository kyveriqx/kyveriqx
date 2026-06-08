/* Raw activity feed from `events`. Answers "who's coming, when, and did they
   view or download." Filter by event type via ?type=… ; the chips below switch
   the filter. Identity (email) and tool name are resolved with lookup maps. */

import { supabaseAdmin } from "../../../core/lib/supabase";
import { EVENT_TYPES } from "../../../core/lib/events";
import { toolsById, emailsByUserId } from "../lib/data";
import { Table, Td, Pill, fmtDate } from "../components/ui";

export const dynamic = "force-dynamic";

export default async function AdminActivity({
  searchParams,
}: {
  searchParams: { type?: string };
}) {
  const admin = supabaseAdmin();
  const typeFilter = searchParams.type && EVENT_TYPES.includes(searchParams.type as never) ? searchParams.type : null;

  let q = admin
    .from("events")
    .select("id, type, user_id, tool_id, path, metadata, created_at")
    .order("created_at", { ascending: false })
    .limit(300);
  if (typeFilter) q = q.eq("type", typeFilter);
  const { data: events } = await q;

  const tools = await toolsById();
  const emailMap = await emailsByUserId((events ?? []).map((e) => e.user_id as string | null));

  const chip = (label: string, value: string | null) => {
    const activeChip = (value ?? null) === typeFilter;
    const href = value ? `/admin/activity?type=${value}` : "/admin/activity";
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
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Activity</h1>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {chip("All", null)}
        {EVENT_TYPES.map((t) => chip(t, t))}
      </div>

      <Table headers={["When", "User", "Event", "Tool", "Path", "Details"]}>
        {(events ?? []).map((e) => {
          const tool = e.tool_id ? tools.get(e.tool_id as string) : null;
          const meta = e.metadata as Record<string, unknown> | null;
          const metaStr = meta && Object.keys(meta).length ? JSON.stringify(meta) : "";
          return (
            <tr key={e.id as string}>
              <Td>{fmtDate(e.created_at as string)}</Td>
              <Td>{e.user_id ? emailMap.get(e.user_id as string) ?? "—" : "anon"}</Td>
              <Td><Pill kind="neutral">{String(e.type)}</Pill></Td>
              <Td>{tool?.name ?? "—"}</Td>
              <Td><span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-300)" }}>{String(e.path ?? "—")}</span></Td>
              <Td><span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--ink-400)" }}>{metaStr}</span></Td>
            </tr>
          );
        })}
        {(events ?? []).length === 0 && <tr><Td>No activity for this filter.</Td></tr>}
      </Table>
    </div>
  );
}
