"use client";

/* Polls /api/jobs/[id] like the ledgerreco result views and renders the
   campaign summary: sent / failed counters and a short error table for
   any rows the SMTP server rejected. */

import { useEffect, useRef, useState } from "react";
import { Card } from "../../../core/ui/card";
import { JobProgress } from "../../../core/ui/job-progress";
import type { CampaignResult } from "../lib/types";

type JobStatusValue = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export type Job = {
  id: string;
  status: JobStatusValue;
  result: CampaignResult | null;
  error: string | null;
  updated_at: string;
  job_key: string;
};

const TERMINAL: JobStatusValue[] = ["succeeded", "failed", "cancelled"];

const MAX_ERR_ROWS = 200;

export function CampaignResultView({ jobId, initialJob }: { jobId: string; initialJob?: Job }) {
  const [job, setJob] = useState<Job | null>(initialJob ?? null);
  const [pollErr, setPollErr] = useState<string | null>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    if (initialJob && TERMINAL.includes(initialJob.status)) return;
    cancelled.current = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const r = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = (await r.json()) as Job;
        if (cancelled.current) return;
        setJob(data);
        if (!TERMINAL.includes(data.status)) timer = setTimeout(poll, 2000);
      } catch (e) {
        if (cancelled.current) return;
        setPollErr(e instanceof Error ? e.message : String(e));
      }
    };
    poll();
    return () => { cancelled.current = true; if (timer) clearTimeout(timer); };
  }, [jobId, initialJob]);

  // Same calm progress card the ledgerreco tools use (spinner + animated bar),
  // with email-appropriate wording, so the in-progress experience is consistent
  // across every tool.
  if (pollErr) {
    return (
      <JobProgress
        stage="failed"
        title="We lost connection while checking progress"
        error={`${pollErr} — please refresh the page.`}
      />
    );
  }

  if (!job) return <JobProgress stage="queued" title="Getting your campaign ready…" detail="Your campaign is starting up." />;

  if (job.status !== "succeeded") {
    const stage =
      job.status === "failed" ? "failed"
        : job.status === "cancelled" ? "cancelled"
          : job.status === "running" ? "running"
            : "queued";
    const TITLE: Record<typeof stage, string> = {
      queued: "Getting your campaign ready…",
      running: "Sending your emails…",
      failed: "We couldn’t send this campaign",
      cancelled: "Campaign cancelled",
    };
    const DETAIL: Record<typeof stage, string> = {
      queued: "Your campaign is starting up.",
      running: "Delivering to each recipient — this can take a little while.",
      failed: "Please check the details and try again.",
      cancelled: "This run was cancelled.",
    };
    return <JobProgress stage={stage} title={TITLE[stage]} detail={DETAIL[stage]} error={job.error} />;
  }

  const res = job.result;
  if (!res) {
    return <Card style={{ padding: 24 }}>Job finished but no result was returned.</Card>;
  }

  return (
    <div style={{ display: "grid", gap: 24 }}>
      <SummaryTiles res={res} />
      {res.errors.length > 0 && <ErrorsTable res={res} />}
      {res.failed === 0 && res.sent > 0 && (
        <Card style={{ padding: 20, color: "var(--success-fg)", background: "var(--success-bg)", border: "1px solid var(--success-border)" }}>
          ✓ All {res.sent} emails accepted by the SMTP server.
        </Card>
      )}
    </div>
  );
}

function SummaryTiles({ res }: { res: CampaignResult }) {
  return (
    <Card style={{ padding: 24 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
        <Tile heading="Recipients" value={String(res.total)} sub="rows accepted from your file" />
        <Tile heading="Sent" value={String(res.sent)} sub="handed off to the SMTP server" tone={res.sent > 0 ? "ok" : "neutral"} />
        <Tile heading="Failed" value={String(res.failed)} sub="rejected by the SMTP server" tone={res.failed > 0 ? "warn" : "neutral"} />
      </div>
      <div style={{
        marginTop: 18, padding: "10px 14px",
        background: "var(--bg-elev)", border: "1px solid var(--line)", borderRadius: 10,
        fontSize: 12.5, color: "var(--ink-300)", fontFamily: "var(--font-mono)",
      }}>
        Duration: {(res.durationMs / 1000).toFixed(1)}s
      </div>
    </Card>
  );
}

function Tile({ heading, value, sub, tone = "neutral" }: {
  heading: string; value: string; sub: string; tone?: "ok" | "warn" | "neutral";
}) {
  const color =
    tone === "ok" ? "var(--success-fg)" :
    tone === "warn" ? "var(--warn-fg)" :
    "var(--ink-200)";
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{
        fontSize: 12, letterSpacing: "0.06em", color: "var(--ink-400)",
        fontFamily: "var(--font-mono)", textTransform: "uppercase",
      }}>
        {heading}
      </div>
      <div style={{ fontSize: 32, fontWeight: 700, marginTop: 6, color, letterSpacing: "-0.015em" }}>{value}</div>
      <div style={{ fontSize: 13, color: "var(--ink-300)", marginTop: 6 }}>{sub}</div>
    </div>
  );
}

function ErrorsTable({ res }: { res: CampaignResult }) {
  const rows = res.errors.slice(0, MAX_ERR_ROWS);
  return (
    <Card style={{ padding: 24 }}>
      <h3 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 14px", color: "var(--ink-200)" }}>
        Failures ({res.errors.length})
      </h3>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              <Th>Email</Th>
              <Th>SMTP error</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e, i) => (
              <tr key={i}>
                <Td>{e.email}</Td>
                <Td><span style={{ color: "var(--warn-fg)" }}>{e.message}</span></Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {res.errors.length > MAX_ERR_ROWS && (
        <div style={{ fontSize: 12, color: "var(--ink-400)", marginTop: 10, fontFamily: "var(--font-mono)" }}>
          showing first {MAX_ERR_ROWS} of {res.errors.length} failures
        </div>
      )}
    </Card>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th style={{
      textAlign: "left", padding: "10px 12px", borderBottom: "1px solid var(--line-strong)",
      color: "var(--ink-200)", fontWeight: 700, fontSize: 12, letterSpacing: "0.04em", textTransform: "uppercase",
    }}>{children}</th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return (
    <td style={{
      padding: "10px 12px", borderBottom: "1px solid var(--line)",
      textAlign: "left", verticalAlign: "top", color: "var(--ink-100)",
    }}>
      {children}
    </td>
  );
}
