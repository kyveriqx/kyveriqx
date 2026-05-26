"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAppStore } from "@orgmis/lib/store";
import { Card, Button, Badge, Textarea, Input, Label } from "@orgmis/components/ui";
import {
  ArrowLeft,
  Download,
  FileSpreadsheet,
  Presentation,
  FileText,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  RefreshCw,
} from "lucide-react";

type RunStatus = "idle" | "queued" | "running" | "completed" | "failed";

// Kyveriqx jobs-row shape returned by /api/jobs/[id]
type JobStatusValue = "queued" | "running" | "succeeded" | "failed" | "cancelled";
type JobRow = {
  id: string;
  status: JobStatusValue;
  result: { outputs?: { pptx?: string; pdf?: string; xlsx?: string } } | null;
  error: string | null;
};

type RunResponse = {
  runId: string;
  status: RunStatus;
  outputs?: { pptx?: string; pdf?: string; xlsx?: string };
  error?: string;
  progress?: number;
};

export default function GeneratePage() {
  const router = useRouter();
  const { branding, files, outlook, setOutlook, lastRunId, setLastRunId } = useAppStore();
  const [status, setStatus] = useState<RunStatus>("idle");
  const [outputs, setOutputs] = useState<RunResponse["outputs"]>(undefined);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!files.glOrTrialBalance) router.replace("/tools/orgmis/upload");
  }, [files.glOrTrialBalance, router]);

  async function startGeneration() {
    setStatus("queued");
    setError(null);
    setOutputs(undefined);
    setProgress(5);
    try {
      const res = await fetch("/api/orgmis/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branding, files, outlook }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { jobId: string };
      setLastRunId(data.jobId);
      setStatus("running");
      // Kyveriqx jobs don't emit real progress; fake a slow ramp for UX.
      let fake = 10;
      const tick = setInterval(() => {
        fake = Math.min(fake + 5, 90);
        setProgress(fake);
      }, 2000);
      pollStatus(data.jobId).finally(() => clearInterval(tick));
    } catch (e: any) {
      setStatus("failed");
      setError(e.message || "Failed to start generation");
    }
  }

  async function pollStatus(jobId: string) {
    let tries = 0;
    while (tries < 120) {
      await new Promise((r) => setTimeout(r, 2000));
      tries++;
      try {
        const r = await fetch(`/api/jobs/${jobId}`);
        if (!r.ok) continue;
        const data = (await r.json()) as JobRow;
        if (data.status === "succeeded") {
          setStatus("completed");
          setOutputs(data.result?.outputs);
          setProgress(100);
          return;
        }
        if (data.status === "failed" || data.status === "cancelled") {
          setStatus("failed");
          setError(data.error || "Generation failed");
          return;
        }
      } catch {
        // ignore transient failures, keep polling
      }
    }
    setStatus("failed");
    setError("Generation timed out. Please try again.");
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Generate your reports</h1>
          <p className="text-slate-500 mt-1">
            Customize the forward-looking section and produce your final deliverables.
          </p>
        </div>
        <Badge tone="brand">Step 4 of 4</Badge>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Left: outlook content */}
        <div className="lg:col-span-2 space-y-5">
          <Card
            title="Strategic Outlook — FY 25-26"
            subtitle="These bullets populate the 'Outlook' slide. Edit them to reflect your strategy."
          >
            <div className="space-y-6">
              {(["growth", "profitability", "capability"] as const).map((key) => {
                const pillar = outlook[key];
                return (
                  <div key={key}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded text-white bg-brand-700">
                        {pillar.tag}
                      </span>
                      <Input
                        value={pillar.title}
                        onChange={(e) =>
                          setOutlook({
                            [key]: { ...pillar, title: e.target.value },
                          } as any)
                        }
                        className="flex-1"
                      />
                    </div>
                    <Textarea
                      value={pillar.bullets.join("\n")}
                      onChange={(e) =>
                        setOutlook({
                          [key]: { ...pillar, bullets: e.target.value.split("\n").filter(Boolean) },
                        } as any)
                      }
                      rows={4}
                      placeholder="One bullet per line…"
                    />
                  </div>
                );
              })}
            </div>
          </Card>

          <Card
            title="Key Achievements (4 boxes)"
            subtitle="Editable. These render on the 'Key Achievements' slide. Keep each body under ~200 characters for best fit."
          >
            <div className="grid md:grid-cols-2 gap-4">
              {(outlook.achievements || []).slice(0, 4).map((ach, i) => (
                <div key={i} className="rounded-lg border border-slate-200 p-3 bg-slate-50">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-6 h-6 rounded bg-brand-700 text-white text-xs font-bold flex items-center justify-center">
                      {i + 1}
                    </span>
                    <Input
                      value={ach.title}
                      onChange={(e) => {
                        const next = [...(outlook.achievements || [])];
                        next[i] = { ...next[i], title: e.target.value };
                        setOutlook({ achievements: next });
                      }}
                      placeholder="Achievement title"
                    />
                  </div>
                  <Textarea
                    value={ach.body}
                    onChange={(e) => {
                      const next = [...(outlook.achievements || [])];
                      next[i] = { ...next[i], body: e.target.value };
                      setOutlook({ achievements: next });
                    }}
                    rows={3}
                    placeholder="What was accomplished, in 1-2 sentences"
                  />
                </div>
              ))}
            </div>
          </Card>

          <Card title="Risks & Asks" subtitle="Frames the 'Discussion' slide for the board.">
            <div className="grid md:grid-cols-2 gap-5">
              <div>
                <Label>Key Risks</Label>
                <Textarea
                  value={outlook.risks.join("\n")}
                  onChange={(e) => setOutlook({ risks: e.target.value.split("\n").filter(Boolean) })}
                  rows={6}
                />
              </div>
              <div>
                <Label>Board Asks</Label>
                <Textarea
                  value={outlook.asks.join("\n")}
                  onChange={(e) => setOutlook({ asks: e.target.value.split("\n").filter(Boolean) })}
                  rows={6}
                />
              </div>
            </div>
          </Card>
        </div>

        {/* Right: action panel */}
        <div className="lg:col-span-1">
          <div className="sticky top-24 space-y-4">
            <Card>
              {status === "idle" && (
                <>
                  <div className="text-center py-4">
                    <div className="w-14 h-14 rounded-xl gradient-brand mx-auto flex items-center justify-center mb-3">
                      <Sparkles className="w-7 h-7 text-white" />
                    </div>
                    <h3 className="font-semibold text-slate-900">Ready to generate</h3>
                    <p className="text-sm text-slate-500 mt-1">
                      We'll produce all three deliverables in one go.
                    </p>
                  </div>
                  <Button size="lg" className="w-full mt-3" onClick={startGeneration}>
                    <Sparkles className="w-4 h-4" />
                    Generate All Reports
                  </Button>
                  <p className="text-xs text-slate-500 mt-3 text-center">
                    Runs on Trigger.dev — takes ~30 to 60 seconds.
                  </p>
                </>
              )}

              {(status === "queued" || status === "running") && (
                <>
                  <div className="text-center py-4">
                    <Loader2 className="w-12 h-12 text-brand-700 mx-auto animate-spin mb-3" />
                    <h3 className="font-semibold text-slate-900">
                      {status === "queued" ? "Queued…" : "Generating your reports…"}
                    </h3>
                    <p className="text-sm text-slate-500 mt-1">Please don't close this tab.</p>
                  </div>
                  <div className="bg-slate-100 rounded-full h-2 overflow-hidden">
                    <div
                      className="h-full bg-brand-700 transition-all duration-500"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <div className="text-center text-xs text-slate-500 mt-2">{progress}%</div>
                </>
              )}

              {status === "completed" && outputs && (
                <>
                  <div className="text-center py-2">
                    <div className="w-14 h-14 rounded-xl bg-emerald-100 mx-auto flex items-center justify-center mb-3">
                      <CheckCircle2 className="w-7 h-7 text-emerald-700" />
                    </div>
                    <h3 className="font-semibold text-slate-900">Reports ready!</h3>
                    <p className="text-sm text-slate-500 mt-1">Download below.</p>
                  </div>

                  <div className="space-y-2 mt-4">
                    <DownloadButton
                      icon={Presentation}
                      label="PowerPoint Deck"
                      ext=".pptx"
                      url={outputs.pptx}
                    />
                    <DownloadButton icon={FileText} label="PDF Report" ext=".pdf" url={outputs.pdf} />
                    <DownloadButton
                      icon={FileSpreadsheet}
                      label="MIS Workbook"
                      ext=".xlsx"
                      url={outputs.xlsx}
                    />
                  </div>

                  <Button variant="ghost" size="sm" className="w-full mt-4" onClick={startGeneration}>
                    <RefreshCw className="w-3.5 h-3.5" />
                    Regenerate
                  </Button>
                </>
              )}

              {status === "failed" && (
                <>
                  <div className="text-center py-4">
                    <div className="w-14 h-14 rounded-xl bg-red-100 mx-auto flex items-center justify-center mb-3">
                      <AlertCircle className="w-7 h-7 text-red-700" />
                    </div>
                    <h3 className="font-semibold text-slate-900">Generation failed</h3>
                    <p className="text-sm text-red-700 mt-2 bg-red-50 p-3 rounded-lg">{error}</p>
                  </div>
                  <Button className="w-full mt-3" onClick={startGeneration}>
                    Try again
                  </Button>
                </>
              )}
            </Card>

            <Button variant="ghost" className="w-full" onClick={() => router.push("/tools/orgmis/preview")}>
              <ArrowLeft className="w-4 h-4" /> Back to Preview
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function DownloadButton({
  icon: Icon,
  label,
  ext,
  url,
}: {
  icon: any;
  label: string;
  ext: string;
  url?: string;
}) {
  if (!url) return null;
  return (
    <a
      href={url}
      download
      className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 hover:border-brand-500 hover:bg-brand-50 transition group"
    >
      <div className="w-9 h-9 rounded-lg bg-brand-50 group-hover:bg-white flex items-center justify-center">
        <Icon className="w-4 h-4 text-brand-700" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-medium text-slate-900 text-sm">{label}</div>
        <div className="text-xs text-slate-500">{ext}</div>
      </div>
      <Download className="w-4 h-4 text-slate-400 group-hover:text-brand-700" />
    </a>
  );
}
