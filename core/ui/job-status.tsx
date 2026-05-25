"use client";

/* Live job status — polls /api/jobs/[id] every 2 seconds and renders
   queued -> running -> succeeded/failed. The architecture says the
   browser polls Supabase, never Trigger.dev directly. */

import { useEffect, useRef, useState } from "react";

type JobStatusValue = "queued" | "running" | "succeeded" | "failed" | "cancelled";

type Job = {
  id: string;
  status: JobStatusValue;
  result: unknown;
  error: string | null;
  updated_at: string;
  job_key: string;
};

const TERMINAL: JobStatusValue[] = ["succeeded", "failed", "cancelled"];

export function JobStatus({ jobId }: { jobId: string }) {
  const [job, setJob] = useState<Job | null>(null);
  const [pollErr, setPollErr] = useState<string | null>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const r = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = (await r.json()) as Job;
        if (cancelled.current) return;
        setJob(data);
        if (!TERMINAL.includes(data.status)) {
          timer = setTimeout(poll, 2000);
        }
      } catch (e) {
        if (cancelled.current) return;
        setPollErr(e instanceof Error ? e.message : String(e));
      }
    };

    poll();
    return () => {
      cancelled.current = true;
      if (timer) clearTimeout(timer);
    };
  }, [jobId]);

  if (pollErr) {
    return (
      <div style={{ color: "#FFB3B3", padding: 16, border: "1px solid rgba(255,100,100,0.4)", borderRadius: 10 }}>
        Polling error: {pollErr}
      </div>
    );
  }

  if (!job) {
    return <div style={{ color: "var(--ink-400)", padding: 16 }}>Loading…</div>;
  }

  const label: Record<JobStatusValue, string> = {
    queued: "Queued",
    running: "Running…",
    succeeded: "Done",
    failed: "Failed",
    cancelled: "Cancelled",
  };

  const color =
    job.status === "succeeded" ? "var(--blue-400)" :
    job.status === "failed" ? "#FFB3B3" :
    "var(--ink-200)";

  return (
    <div
      style={{
        padding: 20,
        border: "1px solid var(--line)",
        borderRadius: 14,
        background: "linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.015))",
      }}
    >
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-400)" }}>
        job {job.id.slice(0, 8)} · {job.job_key}
      </div>
      <div style={{ fontSize: 22, fontWeight: 600, color, marginTop: 4 }}>
        {label[job.status]}
      </div>
      {job.error && (
        <pre
          style={{
            color: "#FFB3B3",
            marginTop: 12,
            fontSize: 13,
            background: "rgba(255,80,80,0.06)",
            padding: 10,
            borderRadius: 8,
            whiteSpace: "pre-wrap",
          }}
        >
          {job.error}
        </pre>
      )}
      {job.status === "succeeded" && job.result != null && (
        <pre
          style={{
            marginTop: 12,
            fontSize: 12.5,
            background: "rgba(255,255,255,0.04)",
            padding: 12,
            borderRadius: 8,
            overflow: "auto",
            color: "var(--ink-200)",
          }}
        >
          {JSON.stringify(job.result, null, 2)}
        </pre>
      )}
    </div>
  );
}
