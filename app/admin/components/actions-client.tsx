"use client";

/* Client wrappers around the admin server actions. Each shows a pending state
   and a brief inline result, then refreshes the route so the server-rendered
   tables reflect the mutation. Kept deliberately small — buttons and selects,
   no heavy form state. */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  extendTrial,
  setSubscriptionStatus,
  setUserActive,
  updateFeedback,
  type ActionResult,
} from "../actions";

function useAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  function run(fn: () => Promise<ActionResult>, okText = "Done") {
    setMsg(null);
    start(async () => {
      const res = await fn();
      if (res.ok) {
        setMsg({ ok: true, text: okText });
        router.refresh();
      } else {
        setMsg({ ok: false, text: res.error });
      }
    });
  }
  return { pending, msg, run };
}

const btn: React.CSSProperties = {
  padding: "5px 10px",
  fontSize: 12,
  fontWeight: 600,
  borderRadius: 8,
  border: "1px solid var(--line-strong)",
  background: "var(--bg-elev)",
  color: "var(--ink-100)",
  cursor: "pointer",
};

function Msg({ msg }: { msg: { ok: boolean; text: string } | null }) {
  if (!msg) return null;
  return (
    <span style={{ fontSize: 11.5, marginLeft: 8, color: msg.ok ? "var(--success-fg)" : "var(--warn-fg)" }}>
      {msg.text}
    </span>
  );
}

export function UserActiveToggle({ userId, active }: { userId: string; active: boolean }) {
  const { pending, msg, run } = useAction();
  return (
    <span>
      <button
        style={{ ...btn, color: active ? "var(--warn-fg)" : "var(--success-fg)" }}
        disabled={pending}
        onClick={() => run(() => setUserActive(userId, !active), active ? "Paused" : "Re-enabled")}
      >
        {active ? "Pause account" : "Re-enable"}
      </button>
      <Msg msg={msg} />
    </span>
  );
}

export function SubscriptionControls({
  userId,
  toolId,
}: {
  userId: string;
  toolId: string;
}) {
  const { pending, msg, run } = useAction();
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <button style={btn} disabled={pending} onClick={() => run(() => extendTrial(userId, toolId, 15), "Trial +15d")}>
        +15d trial
      </button>
      <button
        style={{ ...btn, color: "var(--success-fg)" }}
        disabled={pending}
        onClick={() => run(() => setSubscriptionStatus(userId, toolId, "active"), "Activated")}
      >
        Activate
      </button>
      <button
        style={{ ...btn, color: "var(--warn-fg)" }}
        disabled={pending}
        onClick={() => run(() => setSubscriptionStatus(userId, toolId, "cancelled"), "Cancelled")}
      >
        Cancel
      </button>
      <Msg msg={msg} />
    </span>
  );
}

export function FeedbackTriage({
  id,
  status,
  notes,
}: {
  id: string;
  status: string;
  notes: string | null;
}) {
  const { pending, msg, run } = useAction();
  const [note, setNote] = useState(notes ?? "");
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <select
          defaultValue={status}
          disabled={pending}
          onChange={(e) => run(() => updateFeedback(id, { status: e.target.value }), "Status updated")}
          style={{ ...btn, padding: "5px 8px" }}
        >
          <option value="open">open</option>
          <option value="in_progress">in_progress</option>
          <option value="resolved">resolved</option>
          <option value="closed">closed</option>
        </select>
        <Msg msg={msg} />
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Add an internal note…"
          style={{
            flex: 1,
            padding: "5px 8px",
            fontSize: 12,
            borderRadius: 8,
            border: "1px solid var(--line-strong)",
            background: "var(--bg-elev)",
            color: "var(--ink-100)",
          }}
        />
        <button style={btn} disabled={pending} onClick={() => run(() => updateFeedback(id, { admin_notes: note }), "Note saved")}>
          Save note
        </button>
      </div>
    </div>
  );
}
