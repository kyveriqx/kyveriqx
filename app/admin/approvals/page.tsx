/* Email-campaign send approvals. Customers request access on the tool; the
   owner approves/rejects here before they can connect a mailbox or send.
   Filter by status via ?status=… (defaults to pending first). Mirrors the
   feedback page: a table of requests with inline Approve/Reject controls. */

import { supabaseAdmin } from "../../../core/lib/supabase";
import { emailsByUserId } from "../lib/data";
import { Table, Td, Pill, StatTile, fmtDate, type PillKind } from "../components/ui";
import { ApprovalControls } from "../components/actions-client";

export const dynamic = "force-dynamic";

const STATUSES = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
];

function statusPillKind(status: string): PillKind {
  if (status === "approved") return "ok";
  if (status === "rejected") return "warn";
  return "amber"; // pending
}

export default async function AdminApprovals({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  const admin = supabaseAdmin();
  const statusFilter =
    searchParams.status && STATUSES.some((s) => s.value === searchParams.status)
      ? searchParams.status
      : null;

  let q = admin
    .from("emailcampaign_approvals")
    .select("user_id, status, requested_at, decided_at, admin_notes")
    // pending first, then most recently requested
    .order("requested_at", { ascending: false })
    .limit(300);
  if (statusFilter) q = q.eq("status", statusFilter);
  const { data: rows } = await q;

  const items = rows ?? [];
  const emailMap = await emailsByUserId(items.map((r) => r.user_id as string));
  const pendingCount = items.filter((r) => String(r.status) === "pending").length;

  const chip = (label: string, value: string | null) => {
    const active = (value ?? null) === statusFilter;
    const href = value ? `/admin/approvals?status=${value}` : "/admin/approvals";
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
          background: active ? "var(--accent-bg-soft)" : "var(--bg-elev)",
          color: active ? "var(--accent)" : "var(--ink-300)",
        }}
      >
        {label}
      </a>
    );
  };

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Email campaign approvals</h1>

      {statusFilter !== "approved" && statusFilter !== "rejected" && (
        <div style={{ maxWidth: 260 }}>
          <StatTile
            label="Pending requests"
            value={pendingCount}
            tone={pendingCount > 0 ? "amber" : "neutral"}
          />
        </div>
      )}

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {chip("All", null)}
        {STATUSES.map((s) => chip(s.label, s.value))}
      </div>

      {items.length === 0 ? (
        <div style={{ padding: 24, color: "var(--ink-300)" }}>No requests for this filter.</div>
      ) : (
        <Table headers={["User", "Status", "Requested", "Decided", "Decision"]}>
          {items.map((r) => {
            const userId = r.user_id as string;
            const status = String(r.status);
            return (
              <tr key={userId}>
                <Td>{emailMap.get(userId) ?? "unknown"}</Td>
                <Td>
                  <Pill kind={statusPillKind(status)}>{status}</Pill>
                </Td>
                <Td>{fmtDate(r.requested_at as string)}</Td>
                <Td>{fmtDate(r.decided_at as string | null)}</Td>
                <Td>
                  <ApprovalControls
                    userId={userId}
                    status={status}
                    notes={(r.admin_notes as string | null) ?? null}
                  />
                </Td>
              </tr>
            );
          })}
        </Table>
      )}
    </div>
  );
}
