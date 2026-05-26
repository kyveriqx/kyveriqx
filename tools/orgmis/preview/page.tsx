"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAppStore } from "@orgmis/lib/store";
import { Card, Button, Stat, Badge } from "@orgmis/components/ui";
import type { AnalysisResult } from "@orgmis/lib/financials";
import { formatCrore, formatPercent, cn } from "@orgmis/lib/utils";
import {
  ArrowRight,
  ArrowLeft,
  Loader2,
  AlertCircle,
  TrendingUp,
  TrendingDown,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
  PieChart,
  Pie,
  Legend,
} from "recharts";

const PIE_COLORS = ["#1F3864", "#2E5597", "#BF8F00", "#548235", "#9CA3AF", "#C00000", "#7C3AED", "#0EA5E9"];

export default function PreviewPage() {
  const router = useRouter();
  const files = useAppStore((s) => s.files);
  const branding = useAppStore((s) => s.branding);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const asList = (v: any): any[] =>
      Array.isArray(v) ? v : v && typeof v === "object" && v.id ? [v] : [];
    const glList = asList(files.glOrTrialBalance);
    if (glList.length === 0) {
      router.replace("/tools/orgmis/upload");
      return;
    }
    const urls = (v: any) => asList(v).map((f) => f.blobUrl).filter(Boolean) as string[];
    setLoading(true);
    setError(null);
    fetch("/api/orgmis/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        gl: urls(files.glOrTrialBalance),
        sales: urls(files.sales),
        purchase: urls(files.purchase),
        inventory: urls(files.inventory),
        budget: urls(files.budget),
        customerAging: urls(files.customerAging),
        vendorAging: urls(files.vendorAging),
        period: branding.reportingPeriod,
      }),
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return (await r.json()) as AnalysisResult;
      })
      .then(setAnalysis)
      .catch((e) => setError(e.message || "Failed to parse data"))
      .finally(() => setLoading(false));
    // We intentionally depend only on the URL list lengths to avoid re-render loops on store mutations.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, branding.reportingPeriod, router]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-4">
        <Loader2 className="w-10 h-10 text-brand-700 animate-spin" />
        <p className="text-slate-600">Crunching your numbers…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-lg mx-auto py-16">
        <Card>
          <div className="flex items-start gap-3">
            <AlertCircle className="w-6 h-6 text-red-600 flex-shrink-0" />
            <div>
              <h2 className="font-semibold text-slate-900">Could not analyze data</h2>
              <p className="text-sm text-slate-600 mt-1">{error}</p>
              <Button className="mt-4" onClick={() => router.push("/tools/orgmis/upload")}>
                Back to Upload
              </Button>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  if (!analysis) return null;
  const pl = analysis.plActual;
  const pla = analysis.plAnnualized;
  const monthly = analysis.monthlyRevenue.map((m) => ({
    ...m,
    label: new Date(m.month + "-01").toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
    cr: m.revenue / 1e7,
  }));
  const firstRev = monthly[0]?.revenue || 0;
  const lastRev = monthly.filter(m => m.revenue > 1000).slice(-1)[0]?.revenue || 0;
  const growth = firstRev ? ((lastRev / firstRev) - 1) * 100 : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Live preview</h1>
          <p className="text-slate-500 mt-1">
            Verify the numbers before generating your full report.
            <span className="ml-2 text-xs">
              ({analysis.monthsActual} months of actual data • Period: {analysis.period})
            </span>
          </p>
        </div>
        <Badge tone="brand">Step 3 of 4</Badge>
      </div>

      {/* KPI cards row */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Stat label="Revenue" value={formatCrore(pl.revenue)} sub={`Annualized: ${formatCrore(pla.revenue)}`} tone="brand" />
        <Stat
          label="Gross Profit"
          value={formatCrore(pl.grossProfit)}
          sub={`Margin: ${formatPercent(pl.grossMargin)}`}
          tone="success"
        />
        <Stat
          label="EBITDA"
          value={formatCrore(pl.ebitda)}
          sub={`Margin: ${formatPercent(pl.ebitdaMargin)}`}
          tone={pl.ebitda < 0 ? "danger" : "brand"}
        />
        <Stat
          label="EBIT"
          value={formatCrore(pl.ebit)}
          sub={`Margin: ${formatPercent(pl.ebitMargin)}`}
          tone={pl.ebit < 0 ? "danger" : "brand"}
        />
        <Stat
          label="PBT"
          value={formatCrore(pl.pbt)}
          sub={`Margin: ${formatPercent(pl.pbtMargin)}`}
          tone={pl.pbt < 0 ? "danger" : "brand"}
        />
        <Stat
          label="PAT (Net Profit)"
          value={formatCrore(pl.pat)}
          sub={`Margin: ${formatPercent(pl.patMargin)}`}
          tone={pl.pat < 0 ? "danger" : "brand"}
          accent="#BF8F00"
        />
      </div>

      {/* AI Summary */}
      {analysis.aiSummary && (
        <Card title="AI Summary" subtitle="Automated read of your financials">
          <div className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">
            {analysis.aiSummary}
          </div>
        </Card>
      )}

      {/* Critical Issues + Growth Opportunities */}
      {(analysis.criticalIssues.length > 0 || analysis.growthOpportunities.length > 0) && (
        <div className="grid lg:grid-cols-2 gap-5">
          {analysis.criticalIssues.length > 0 && (
            <Card
              title={`Critical Issues (${analysis.criticalIssues.length})`}
              subtitle="Auto-detected from your data — ranked by severity"
            >
              <div className="space-y-3">
                {analysis.criticalIssues.map((issue) => (
                  <div
                    key={issue.rank}
                    className={cn(
                      "rounded-lg p-3 border-l-4",
                      issue.severity === "high"
                        ? "bg-red-50 border-red-500"
                        : issue.severity === "medium"
                        ? "bg-amber-50 border-amber-500"
                        : "bg-slate-50 border-slate-400"
                    )}
                  >
                    <div className="flex items-start gap-2">
                      <span className="font-bold text-slate-400">{issue.rank}.</span>
                      <div className="flex-1">
                        <div className="font-semibold text-slate-900 text-sm">{issue.title}</div>
                        <div className="text-xs text-slate-600 mt-1">{issue.rootCause}</div>
                        <div className="text-xs text-slate-700 mt-2">
                          <span className="font-semibold">Action:</span> {issue.recommendedAction}
                        </div>
                        <div className="text-xs text-emerald-700 mt-1 font-medium">
                          {issue.potentialImpact}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
          {analysis.growthOpportunities.length > 0 && (
            <Card
              title={`Growth Opportunities (${analysis.growthOpportunities.length})`}
              subtitle="Auto-detected upside paths"
            >
              <div className="space-y-3">
                {analysis.growthOpportunities.map((op) => (
                  <div key={op.rank} className="rounded-lg p-3 border-l-4 border-emerald-500 bg-emerald-50">
                    <div className="flex items-start gap-2">
                      <span className="font-bold text-emerald-500">{op.rank}.</span>
                      <div className="flex-1">
                        <div className="font-semibold text-slate-900 text-sm">{op.title}</div>
                        <div className="text-xs text-slate-600 mt-1">{op.rationale}</div>
                        <div className="text-xs text-slate-700 mt-2">
                          <span className="font-semibold">Approach:</span> {op.approach}
                        </div>
                        <div className="text-xs text-emerald-700 mt-1 font-medium">
                          {op.potentialUpside}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Benchmarks vs Industry */}
      {analysis.benchmarks.length > 0 && (
        <Card
          title="Performance vs Industry Benchmarks"
          subtitle="Where you stand against typical SME / mid-market norms"
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-slate-200">
                  <th className="py-2 px-2 font-semibold text-slate-600">Metric</th>
                  <th className="py-2 px-2 font-semibold text-slate-600 text-right">Actual</th>
                  <th className="py-2 px-2 font-semibold text-slate-600 text-right">Benchmark</th>
                  <th className="py-2 px-2 font-semibold text-slate-600 text-center">Status</th>
                  <th className="py-2 px-2 font-semibold text-slate-600">Gap</th>
                </tr>
              </thead>
              <tbody>
                {analysis.benchmarks.map((b, i) => (
                  <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="py-2 px-2 font-medium text-slate-800">{b.metric}</td>
                    <td className="py-2 px-2 text-right tabular-nums font-semibold">{b.actual}</td>
                    <td className="py-2 px-2 text-right tabular-nums text-slate-500">{b.benchmark}</td>
                    <td className="py-2 px-2 text-center">
                      <span
                        className={cn(
                          "text-[10px] font-bold uppercase px-2 py-0.5 rounded",
                          b.status === "good"
                            ? "bg-emerald-100 text-emerald-800"
                            : b.status === "ok"
                            ? "bg-amber-100 text-amber-800"
                            : "bg-red-100 text-red-800"
                        )}
                      >
                        {b.status === "good" ? "On Target" : b.status === "ok" ? "Caution" : "Below"}
                      </span>
                    </td>
                    <td className="py-2 px-2 text-xs text-slate-600">{b.gap}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Balance Sheet + Cost Structure */}
      {(analysis.balanceSheet || analysis.costStructure.length > 0) && (
        <div className="grid lg:grid-cols-2 gap-5">
          {analysis.balanceSheet && (
            <Card title="Balance Sheet Snapshot" subtitle="Computed from GL closing balances">
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                <div>
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                    Assets
                  </div>
                  <BSRow label="Fixed Assets (Net)" value={analysis.balanceSheet.fixedAssetsNet} />
                  <BSRow label="Inventory" value={analysis.balanceSheet.inventory} />
                  <BSRow label="Receivables" value={analysis.balanceSheet.receivables} />
                  <BSRow label="Cash & Bank" value={analysis.balanceSheet.cashAndBank} />
                  <BSRow label="Other Assets" value={analysis.balanceSheet.otherAssets} />
                  <BSRow label="Total Assets" value={analysis.balanceSheet.totalAssets} bold />
                </div>
                <div>
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                    Liabilities & Equity
                  </div>
                  <BSRow label="Equity" value={analysis.balanceSheet.equity} />
                  <BSRow label="Long-term Debt" value={analysis.balanceSheet.longTermDebt} />
                  <BSRow label="Payables" value={analysis.balanceSheet.payables} />
                  <BSRow label="Other Current Liab." value={analysis.balanceSheet.otherCurrentLiab} />
                  <BSRow label="Total" value={analysis.balanceSheet.totalLiabilitiesAndEquity} bold />
                </div>
              </div>
              <div className="mt-4 pt-3 border-t border-slate-200 flex gap-6 text-sm">
                <div>
                  <span className="text-slate-500">Current Ratio:</span>{" "}
                  <span className="font-bold">{analysis.balanceSheet.currentRatio.toFixed(2)}x</span>
                </div>
                <div>
                  <span className="text-slate-500">Debt/Equity:</span>{" "}
                  <span className="font-bold">{analysis.balanceSheet.debtToEquity.toFixed(2)}x</span>
                </div>
              </div>
            </Card>
          )}
          {analysis.costStructure.length > 0 && (
            <Card title="Cost Structure" subtitle="Operating cost breakdown (% of revenue)">
              <div className="space-y-1.5">
                {analysis.costStructure.slice(0, 10).map((c, i) => (
                  <div key={i} className="relative group">
                    <div className="flex items-center justify-between gap-3 py-1.5 px-2 rounded-md hover:bg-slate-50 relative z-10">
                      <span className="text-sm text-slate-700 flex-1 truncate">{c.category}</span>
                      <span className="text-sm font-semibold text-slate-900 tabular-nums w-24 text-right">
                        {formatCrore(c.amount)}
                      </span>
                      <span
                        className={cn(
                          "text-xs font-semibold tabular-nums w-14 text-right",
                          c.isWatchlist ? "text-red-700" : "text-slate-500"
                        )}
                      >
                        {c.percentOfRevenue.toFixed(1)}%
                      </span>
                      {c.isWatchlist && (
                        <span className="text-[10px] font-bold uppercase bg-red-100 text-red-800 px-1.5 py-0.5 rounded">
                          Watch
                        </span>
                      )}
                    </div>
                    <div
                      className="absolute inset-y-0 left-0 rounded-md opacity-10 bg-brand-700"
                      style={{ width: `${Math.min(100, c.percentOfRevenue * 2)}%` }}
                    />
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Improvement initiatives */}
      {analysis.improvements.length > 0 && (
        <Card
          title="Improvement Initiatives (Quantified)"
          subtitle={`Total potential upside: ${formatCrore(
            analysis.improvements.reduce((s, i) => s + i.savings, 0)
          )}`}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-slate-200">
                  <th className="py-2 px-2 font-semibold text-slate-600">Action</th>
                  <th className="py-2 px-2 font-semibold text-slate-600 text-right">Impact (₹ p.a.)</th>
                  <th className="py-2 px-2 font-semibold text-slate-600 text-center">Timeline</th>
                  <th className="py-2 px-2 font-semibold text-slate-600 text-center">Difficulty</th>
                </tr>
              </thead>
              <tbody>
                {analysis.improvements.map((m, i) => (
                  <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="py-2 px-2">
                      <div className="font-medium text-slate-800">{m.action}</div>
                      <div className="text-xs text-slate-500 mt-0.5">{m.rationale}</div>
                    </td>
                    <td className="py-2 px-2 text-right tabular-nums font-semibold text-emerald-700">
                      {formatCrore(m.savings)}
                    </td>
                    <td className="py-2 px-2 text-center text-xs text-slate-600">{m.timeline}</td>
                    <td className="py-2 px-2 text-center">
                      <span
                        className={cn(
                          "text-[10px] font-bold uppercase px-2 py-0.5 rounded",
                          m.difficulty === "easy"
                            ? "bg-emerald-100 text-emerald-800"
                            : m.difficulty === "medium"
                            ? "bg-amber-100 text-amber-800"
                            : "bg-red-100 text-red-800"
                        )}
                      >
                        {m.difficulty}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Key insights chips */}
      {analysis.insights.length > 0 && (
        <Card title="Key Insights" subtitle="Quick-read commentary across revenue, margin, cash and concentration">
          <div className="grid md:grid-cols-2 gap-3">
            {analysis.insights.map((it, i) => (
              <div
                key={i}
                className={cn(
                  "rounded-lg p-3 border",
                  it.severity === "high"
                    ? "bg-red-50 border-red-200"
                    : it.severity === "medium"
                    ? "bg-amber-50 border-amber-200"
                    : "bg-slate-50 border-slate-200"
                )}
              >
                <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  {it.category}
                </div>
                <div className="font-semibold text-slate-900 text-sm mt-1">{it.title}</div>
                <div className="text-xs text-slate-600 mt-1 leading-relaxed">{it.detail}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Monthly trend */}
      <div className="grid lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2">
          <Card
            title="Monthly Revenue Trend"
            subtitle={`Apr → Mar trajectory  •  ${analysis.period}`}
            action={
              <div className={cn("flex items-center gap-1 text-sm font-semibold", growth >= 0 ? "text-emerald-600" : "text-red-600")}>
                {growth >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                {growth >= 0 ? "+" : ""}{growth.toFixed(0)}% Apr→Latest
              </div>
            }
          >
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthly}>
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#64748b" }} />
                  <YAxis
                    tick={{ fontSize: 11, fill: "#64748b" }}
                    tickFormatter={(v) => `₹${v.toFixed(1)}Cr`}
                  />
                  <Tooltip
                    formatter={(v: number) => formatCrore(v * 1e7)}
                    contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0" }}
                  />
                  <Bar dataKey="cr" fill="#1F3864" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>

        <Card title="Working Capital">
          <div className="space-y-3">
            <Stat label="Receivables (AR)" value={formatCrore(analysis.totalAR)} tone="brand" />
            <Stat label="Payables (AP)" value={formatCrore(analysis.totalAP)} tone="brand" accent="#BF8F00" />
            <Stat
              label="Net Working Capital"
              value={formatCrore(analysis.totalAR - analysis.totalAP)}
              tone={analysis.totalAR - analysis.totalAP >= 0 ? "success" : "danger"}
            />
          </div>
        </Card>
      </div>

      {/* Geo & Currency */}
      {(analysis.countryRevenue.length > 0 || analysis.currencyRevenue.length > 0) && (
        <div className="grid lg:grid-cols-2 gap-5">
          {analysis.countryRevenue.length > 0 && (
            <Card title="Revenue by Country" subtitle="Based on invoice sample">
              <div className="h-64">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie
                      data={analysis.countryRevenue}
                      dataKey="amount"
                      nameKey="country"
                      cx="50%"
                      cy="50%"
                      outerRadius={80}
                      label={(e: any) => `${e.country} (${(e.percent * 100).toFixed(0)}%)`}
                    >
                      {analysis.countryRevenue.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </Card>
          )}
          {analysis.currencyRevenue.length > 0 && (
            <Card title="Revenue by Currency" subtitle="Based on invoice sample">
              <div className="h-64">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie
                      data={analysis.currencyRevenue}
                      dataKey="amount"
                      nameKey="currency"
                      cx="50%"
                      cy="50%"
                      outerRadius={80}
                      label={(e: any) => `${e.currency} (${(e.percent * 100).toFixed(0)}%)`}
                    >
                      {analysis.currencyRevenue.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Aging + Cash Flow */}
      {(analysis.customerAging || analysis.vendorAging) && (
        <div className="grid lg:grid-cols-2 gap-5">
          {analysis.customerAging && (
            <AgingCard
              title="Customer Aging (Receivables)"
              tone="brand"
              data={analysis.customerAging}
              partyLabel="Customer"
            />
          )}
          {analysis.vendorAging && (
            <AgingCard
              title="Vendor Aging (Payables)"
              tone="gold"
              data={analysis.vendorAging}
              partyLabel="Vendor"
            />
          )}
        </div>
      )}

      {analysis.cashFlow && (
        <Card
          title="Cash-Flow Projection (Next 90 Days)"
          subtitle={`Expected collections vs payments by 30-day window${analysis.customerAging?.asOfDate ? ` — as of ${analysis.customerAging.asOfDate}` : ""}`}
        >
          <div className="grid md:grid-cols-3 gap-3 mb-4">
            <Stat
              label="Expected Collections (90d)"
              value={formatCrore(analysis.cashFlow.totalCollections)}
              tone="success"
            />
            <Stat
              label="Expected Payments (90d)"
              value={formatCrore(analysis.cashFlow.totalPayments)}
              tone="danger"
            />
            <Stat
              label="Net Cash Flow"
              value={formatCrore(analysis.cashFlow.netCashFlow)}
              tone={analysis.cashFlow.netCashFlow >= 0 ? "success" : "danger"}
              accent="#BF8F00"
            />
          </div>
          <div className="h-56">
            <ResponsiveContainer>
              <BarChart data={analysis.cashFlow.windows.map((w) => ({
                label: w.label,
                Collections: w.collections / 1e7,
                Payments: -(w.payments / 1e7),
                Net: w.net / 1e7,
              }))}>
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#64748b" }} />
                <YAxis tick={{ fontSize: 11, fill: "#64748b" }} tickFormatter={(v) => `₹${v.toFixed(1)}Cr`} />
                <Tooltip
                  formatter={(v: number) => `₹${Math.abs(v).toFixed(2)} Cr`}
                  contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0" }}
                />
                <Legend />
                <Bar dataKey="Collections" fill="#548235" radius={[6, 6, 0, 0]} />
                <Bar dataKey="Payments" fill="#C00000" radius={[6, 6, 0, 0]} />
                <Bar dataKey="Net" fill="#1F3864" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="text-xs text-slate-500 mt-3 italic">
            Heuristic: Current + 0-30 buckets convert to cash in the next 30 days; older buckets recover with a discount (70% / 50%). Tune in <code>buildCashFlow()</code>.
          </p>
        </Card>
      )}

      {/* Budget vs Actual variance */}
      {analysis.hasBudget && analysis.variance.length > 0 && (
        <Card
          title="Budget vs Actual — Variance Analysis"
          subtitle="Computed against annualized actuals. Income lines: positive variance is favorable. Expense lines: negative variance is favorable."
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-slate-200">
                  <th className="py-2 px-2 font-semibold text-slate-600">Line Item</th>
                  <th className="py-2 px-2 font-semibold text-slate-600">Type</th>
                  <th className="py-2 px-2 font-semibold text-slate-600 text-right">Budget</th>
                  <th className="py-2 px-2 font-semibold text-slate-600 text-right">Actual</th>
                  <th className="py-2 px-2 font-semibold text-slate-600 text-right">Variance</th>
                  <th className="py-2 px-2 font-semibold text-slate-600 text-right">Var %</th>
                  <th className="py-2 px-2 font-semibold text-slate-600 text-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {analysis.variance.map((v, i) => (
                  <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="py-2 px-2 font-medium text-slate-800">{v.lineItem}</td>
                    <td className="py-2 px-2">
                      <span
                        className={cn(
                          "text-[10px] font-bold uppercase px-1.5 py-0.5 rounded",
                          v.kind === "income"
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-amber-100 text-amber-800"
                        )}
                      >
                        {v.kind}
                      </span>
                    </td>
                    <td className="py-2 px-2 text-right tabular-nums">{formatCrore(v.budget)}</td>
                    <td className="py-2 px-2 text-right tabular-nums">{formatCrore(v.actual)}</td>
                    <td
                      className={cn(
                        "py-2 px-2 text-right tabular-nums font-semibold",
                        v.favorable ? "text-emerald-700" : "text-red-700"
                      )}
                    >
                      {formatCrore(v.variance)}
                    </td>
                    <td
                      className={cn(
                        "py-2 px-2 text-right tabular-nums",
                        v.favorable ? "text-emerald-700" : "text-red-700"
                      )}
                    >
                      {v.variancePct >= 0 ? "+" : ""}
                      {v.variancePct.toFixed(1)}%
                    </td>
                    <td className="py-2 px-2 text-center">
                      <span
                        className={cn(
                          "text-[10px] font-bold uppercase px-2 py-0.5 rounded",
                          v.favorable ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"
                        )}
                      >
                        {v.favorable ? "Favorable" : "Adverse"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Top tables */}
      <div className="grid lg:grid-cols-2 gap-5">
        {analysis.topCustomers.length > 0 && (
          <Card title="Top Customers" subtitle="By invoice value (sample period)">
            <ListTable rows={analysis.topCustomers.map((c) => ({ name: c.name, amount: c.amount }))} />
          </Card>
        )}
        {analysis.topVendors.length > 0 && (
          <Card title="Top Vendors" subtitle="By purchase value (sample period)">
            <ListTable rows={analysis.topVendors.map((v) => ({ name: v.name, amount: v.amount }))} accentColor="#BF8F00" />
          </Card>
        )}
      </div>

      {/* Action bar */}
      <div className="sticky bottom-4 bg-white border border-slate-200 rounded-xl shadow-lg p-4 flex items-center justify-between">
        <div className="text-sm text-slate-600">
          Numbers look good? Generate your branded deck, MIS workbook, and PDF.
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => router.push("/tools/orgmis/upload")}>
            <ArrowLeft className="w-4 h-4" /> Back
          </Button>
          <Button size="lg" onClick={() => router.push("/tools/orgmis/generate")}>
            Generate Reports
            <ArrowRight className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function BSRow({ label, value, bold = false }: { label: string; value: number; bold?: boolean }) {
  return (
    <div
      className={cn(
        "flex justify-between py-1 text-sm",
        bold && "border-t border-slate-200 mt-1 pt-2 font-semibold"
      )}
    >
      <span className={cn("text-slate-700", bold && "text-slate-900")}>{label}</span>
      <span className="tabular-nums text-slate-900">{formatCrore(value)}</span>
    </div>
  );
}

function AgingCard({
  title,
  data,
  tone,
  partyLabel,
}: {
  title: string;
  data: import("@orgmis/lib/financials").AgingResult;
  tone: "brand" | "gold";
  partyLabel: string;
}) {
  const buckets = data.buckets;
  const chartData = (["Current", "0-30", "31-60", "61-90", "91-180", "180+"] as const).map(
    (b) => ({ bucket: b, amount: (buckets[b] || 0) / 1e7 })
  );
  const fill = tone === "gold" ? "#BF8F00" : "#1F3864";
  return (
    <Card
      title={title}
      subtitle={`Outstanding: ${formatCrore(data.totalOutstanding)} across ${data.partyCount} ${partyLabel.toLowerCase()}${
        data.partyCount === 1 ? "" : "s"
      }${data.asOfDate ? ` — as of ${data.asOfDate}` : ""}`}
    >
      <div className="h-44 mb-3">
        <ResponsiveContainer>
          <BarChart data={chartData}>
            <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: "#64748b" }} />
            <YAxis tick={{ fontSize: 11, fill: "#64748b" }} tickFormatter={(v) => `₹${v.toFixed(1)}Cr`} />
            <Tooltip formatter={(v: number) => `₹${v.toFixed(2)} Cr`} contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0" }} />
            <Bar dataKey="amount" fill={fill} radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="space-y-1">
        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
          Top {partyLabel}s by Outstanding
        </div>
        {data.topParties.slice(0, 5).map((p, i) => (
          <div key={i} className="flex items-center justify-between text-sm py-1.5 px-2 rounded hover:bg-slate-50">
            <span className="text-slate-700 truncate flex-1">
              <span className="font-bold text-slate-400 mr-2">{i + 1}.</span>
              {p.name}
            </span>
            <span
              className={cn(
                "text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ml-2",
                p.bucket === "Current"
                  ? "bg-emerald-100 text-emerald-800"
                  : p.bucket === "0-30"
                  ? "bg-slate-100 text-slate-700"
                  : p.bucket === "31-60"
                  ? "bg-amber-100 text-amber-800"
                  : "bg-red-100 text-red-800"
              )}
            >
              {p.bucket}
            </span>
            <span className="font-semibold text-slate-900 tabular-nums ml-2 w-24 text-right">
              {formatCrore(p.amount)}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function ListTable({
  rows,
  accentColor = "#1F3864",
}: {
  rows: Array<{ name: string; amount: number }>;
  accentColor?: string;
}) {
  const total = rows.reduce((s, r) => s + r.amount, 0) || 1;
  return (
    <div className="space-y-1.5">
      {rows.slice(0, 8).map((r, i) => {
        const pct = (r.amount / total) * 100;
        return (
          <div key={i} className="relative group">
            <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-md hover:bg-slate-50 relative z-10">
              <span className="text-sm text-slate-700 truncate flex-1">
                <span className="font-bold text-slate-400 mr-2">{i + 1}.</span>
                {r.name}
              </span>
              <span className="text-sm font-semibold text-slate-900 tabular-nums">
                {r.amount.toLocaleString("en-IN")}
              </span>
              <span className="text-xs text-slate-500 tabular-nums w-12 text-right">
                {pct.toFixed(1)}%
              </span>
            </div>
            <div
              className="absolute inset-y-0 left-0 rounded-md opacity-10"
              style={{ width: `${pct}%`, background: accentColor }}
            />
          </div>
        );
      })}
    </div>
  );
}
