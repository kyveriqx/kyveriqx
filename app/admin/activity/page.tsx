/* Raw activity feed from `events`. Answers "who's coming, when, and did they
   view or download." Two filters, combinable: event type (?type=…) and date
   window — either a preset (?range=24h|7d|30d|all) or a custom calendar range
   (?from=YYYY-MM-DD&to=YYYY-MM-DD). Custom dates are interpreted in IST
   (+05:30) so the boundaries match the founder's local calendar. */

import { supabaseAdmin } from "../../../core/lib/supabase";
import { EVENT_TYPES } from "../../../core/lib/events";
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

type SearchParams = { type?: string; range?: string; from?: string; to?: string };

const isYmd = (s: string | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

export default async function AdminActivity({ searchParams }: { searchParams: SearchParams }) {
  const admin = supabaseAdmin();

  const typeFilter = searchParams.type && EVENT_TYPES.includes(searchParams.type as never) ? searchParams.type : null;
  const from = isYmd(searchParams.from) ? searchParams.from : null;
  const to = isYmd(searchParams.to) ? searchParams.to : null;
  const customDates = !!(from || to);
  // Preset only applies when no custom range is set. Default to 7 days.
  const range = customDates ? null : (RANGES.some((r) => r.value === searchParams.range) ? searchParams.range! : "7d");

  // Resolve the window to created_at bounds.
  let gte: string | null = null;
  let lte: string | null = null;
  if (customDates) {
    if (from) gte = `${from}T00:00:00+05:30`;
    if (to) lte = `${to}T23:59:59+05:30`;
  } else if (range === "24h") {
    gte = new Date(Date.now() - DAY).toISOString();
  } else if (range === "7d") {
    gte = new Date(Date.now() - 7 * DAY).toISOString();
  } else if (range === "30d") {
    gte = new Date(Date.now() - 30 * DAY).toISOString();
  } // "all" → no bound

  let q = admin
    .from("events")
    .select("id, type, user_id, tool_id, path, metadata, created_at")
    .order("created_at", { ascending: false })
    .limit(500);
  if (typeFilter) q = q.eq("type", typeFilter);
  if (gte) q = q.gte("created_at", gte);
  if (lte) q = q.lte("created_at", lte);
  const { data: events } = await q;

  const tools = await toolsById();
  const emailMap = await emailsByUserId((events ?? []).map((e) => e.user_id as string | null));

  // Build a href that preserves the *other* filter dimension. type=null clears it.
  const buildHref = (next: { type?: string | null; range?: string; from?: string; to?: string }): string => {
    const p = new URLSearchParams();
    const t = next.type !== undefined ? next.type : typeFilter;
    if (t) p.set("type", t);
    if (next.from || next.to) {
      if (next.from) p.set("from", next.from);
      if (next.to) p.set("to", next.to);
    } else if (next.range) {
      p.set("range", next.range);
    } else if (customDates) {
      if (from) p.set("from", from);
      if (to) p.set("to", to);
    } else if (range) {
      p.set("range", range);
    }
    const s = p.toString();
    return s ? `/admin/activity?${s}` : "/admin/activity";
  };

  const chipStyle = (on: boolean): React.CSSProperties => ({
    padding: "6px 12px",
    fontSize: 12.5,
    borderRadius: 999,
    textDecoration: "none",
    border: "1px solid var(--line-strong)",
    background: on ? "var(--accent-bg-soft)" : "var(--bg-elev)",
    color: on ? "var(--accent)" : "var(--ink-300)",
  });

  const inputStyle: React.CSSProperties = {
    padding: "6px 10px",
    fontSize: 12.5,
    borderRadius: 8,
    border: "1px solid var(--line-strong)",
    background: "var(--bg-elev)",
    color: "var(--ink-100)",
    colorScheme: "dark",
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Activity</h1>

      {/* Date window */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 11.5, color: "var(--ink-400)", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
          When
        </span>
        {RANGES.map((r) => (
          <a key={r.value} href={buildHref({ range: r.value, from: undefined, to: undefined })} style={chipStyle(!customDates && range === r.value)}>
            {r.label}
          </a>
        ))}
        {/* Custom calendar range — native GET form, preserves the type filter */}
        <form method="get" action="/admin/activity" style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
          {typeFilter && <input type="hidden" name="type" value={typeFilter} />}
          <input type="date" name="from" defaultValue={from ?? ""} style={inputStyle} aria-label="From date" />
          <span style={{ color: "var(--ink-400)", fontSize: 12 }}>→</span>
          <input type="date" name="to" defaultValue={to ?? ""} style={inputStyle} aria-label="To date" />
          <button type="submit" style={{ ...chipStyle(customDates), cursor: "pointer" }}>Apply</button>
        </form>
      </div>

      {/* Event type */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 11.5, color: "var(--ink-400)", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.04em", marginRight: 4 }}>
          Type
        </span>
        <a href={buildHref({ type: null })} style={chipStyle(!typeFilter)}>All</a>
        {EVENT_TYPES.map((t) => (
          <a key={t} href={buildHref({ type: t })} style={chipStyle(typeFilter === t)}>{t}</a>
        ))}
      </div>

      <div style={{ fontSize: 12.5, color: "var(--ink-400)" }}>
        {(events ?? []).length} event{(events ?? []).length === 1 ? "" : "s"}
        {customDates ? ` · ${from ?? "start"} → ${to ?? "now"}` : range !== "all" ? ` · ${RANGES.find((r) => r.value === range)?.label.toLowerCase()}` : ""}
        {(events ?? []).length >= 500 ? " · showing newest 500" : ""}
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
