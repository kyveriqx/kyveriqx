/* Feedback inbox — reviews, bug reports, and new-tool requests submitted by
   users. Filter by kind via ?kind=… . Each card shows who/when/what, the linked
   tool for issues, the star rating for reviews, and inline triage (status +
   internal note) via the FeedbackTriage control. */

import { supabaseAdmin } from "../../../core/lib/supabase";
import { toolsById, emailsByUserId } from "../lib/data";
import { Card, Pill, SectionTitle, fmtDate, jobStatusKind } from "../components/ui";
import { FeedbackTriage } from "../components/actions-client";

export const dynamic = "force-dynamic";

const KINDS = [
  { value: "review", label: "Reviews" },
  { value: "issue", label: "Issues" },
  { value: "tool_request", label: "Tool requests" },
];

function kindPill(kind: string) {
  if (kind === "review") return <Pill kind="ok">review</Pill>;
  if (kind === "issue") return <Pill kind="warn">issue</Pill>;
  return <Pill kind="amber">tool request</Pill>;
}

export default async function AdminFeedback({
  searchParams,
}: {
  searchParams: { kind?: string };
}) {
  const admin = supabaseAdmin();
  const kindFilter = searchParams.kind && KINDS.some((k) => k.value === searchParams.kind) ? searchParams.kind : null;

  let q = admin
    .from("feedback")
    .select("id, user_id, tool_id, kind, rating, subject, body, status, admin_notes, created_at")
    .order("created_at", { ascending: false })
    .limit(200);
  if (kindFilter) q = q.eq("kind", kindFilter);
  const { data: items } = await q;

  const tools = await toolsById();
  const emailMap = await emailsByUserId((items ?? []).map((f) => f.user_id as string | null));

  const chip = (label: string, value: string | null) => {
    const activeChip = (value ?? null) === kindFilter;
    const href = value ? `/admin/feedback?kind=${value}` : "/admin/feedback";
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
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Feedback</h1>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {chip("All", null)}
        {KINDS.map((k) => chip(k.label, k.value))}
      </div>

      <div style={{ display: "grid", gap: 14 }}>
        {(items ?? []).map((f) => {
          const tool = f.tool_id ? tools.get(f.tool_id as string) : null;
          const rating = f.rating as number | null;
          return (
            <Card key={f.id as string} style={{ padding: 18 }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
                {kindPill(String(f.kind))}
                <Pill kind={jobStatusKind(String(f.status))}>{String(f.status)}</Pill>
                {tool && <Pill kind="neutral">{tool.name}</Pill>}
                {rating != null && <span style={{ color: "var(--amber-fg)", fontSize: 13 }}>{"★".repeat(rating)}{"☆".repeat(5 - rating)}</span>}
                <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--ink-400)" }}>{fmtDate(f.created_at as string)}</span>
              </div>
              {f.subject && <div style={{ fontWeight: 600, marginBottom: 4 }}>{String(f.subject)}</div>}
              <div style={{ fontSize: 14, color: "var(--ink-200)", whiteSpace: "pre-wrap", marginBottom: 6 }}>{String(f.body)}</div>
              <div style={{ fontSize: 12, color: "var(--ink-400)", marginBottom: 12 }}>
                from {f.user_id ? emailMap.get(f.user_id as string) ?? "unknown" : "unknown"}
              </div>
              <FeedbackTriage id={f.id as string} status={String(f.status)} notes={(f.admin_notes as string | null) ?? null} />
            </Card>
          );
        })}
        {(items ?? []).length === 0 && (
          <Card style={{ padding: 24, color: "var(--ink-300)" }}>No feedback for this filter.</Card>
        )}
      </div>
    </div>
  );
}
