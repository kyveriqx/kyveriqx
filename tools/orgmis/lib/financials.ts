/**
 * Lightweight Excel parser + P&L computer for live in-browser/server preview.
 * Mirrors the Python logic in tools/analyze_financials.py.
 * Header row is row 3 by default (common in ERP exports); falls back to row 1 for flat registers.
 */
import * as XLSX from "xlsx";

const FY_START_MONTH = 4; // April = Indian FY start

export type PLResult = {
  revenue: number;
  cogs: number;
  grossProfit: number;
  grossMargin: number;
  operatingExpenses: number;
  otherIncome: number;
  otherExpenses: number;
  ebitda: number;
  ebitdaMargin: number;
  depreciation: number;
  ebit: number;
  ebitMargin: number;
  financeCosts: number;
  pbt: number;
  pbtMargin: number;
  tax: number;
  pat: number;
  patMargin: number;
};

export type VarianceRow = {
  lineItem: string;
  kind: "income" | "expense";
  budget: number;
  actual: number;
  variance: number;       // actual - budget (income: + is favorable, expense: + is unfavorable)
  variancePct: number;    // % of budget
  favorable: boolean;
};

export const AGING_BUCKETS = [
  "Current",
  "0-30",
  "31-60",
  "61-90",
  "91-180",
  "180+",
] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

export type AgingResult = {
  asOfDate: string | null;
  totalOutstanding: number;
  buckets: Record<AgingBucket, number>;
  topParties: Array<{ name: string; amount: number; bucket: AgingBucket; daysOverdue?: number }>;
  partyCount: number;
};

export type CashFlowProjection = {
  windows: Array<{ label: string; collections: number; payments: number; net: number }>;
  totalCollections: number;
  totalPayments: number;
  netCashFlow: number;
};

// === Analytical layer ===

export type Severity = "high" | "medium" | "low" | "info";

export type Insight = {
  category: "revenue" | "margin" | "cashflow" | "concentration" | "efficiency" | "growth";
  title: string;
  detail: string;             // 1-2 sentence commentary
  severity: Severity;
};

export type CriticalIssue = {
  rank: number;
  title: string;
  rootCause: string;          // why it's happening — quotes the data
  recommendedAction: string;  // what to do
  potentialImpact: string;    // ₹ or % impact estimate
  severity: Severity;
};

export type GrowthOpportunity = {
  rank: number;
  title: string;
  rationale: string;          // why this opportunity exists
  approach: string;           // suggested approach
  potentialUpside: string;    // ₹ or % upside estimate
};

export type BalanceSheet = {
  fixedAssetsNet: number;
  inventory: number;
  receivables: number;
  cashAndBank: number;
  otherAssets: number;
  totalAssets: number;

  equity: number;
  longTermDebt: number;
  payables: number;
  otherCurrentLiab: number;
  totalLiabilitiesAndEquity: number;

  currentRatio: number;     // (CA / CL)
  debtToEquity: number;
};

export type CostStructureRow = {
  category: string;
  amount: number;
  percentOfRevenue: number;
  isWatchlist: boolean;         // true if % is unusually high
  benchmark?: string;           // text guidance
};

export type BenchmarkRow = {
  metric: string;
  actual: string;               // formatted value
  actualNumeric: number;        // for chart use
  benchmark: string;            // e.g. "30-40%"
  status: "good" | "ok" | "poor";
  gap: string;                  // human-readable gap
};

export type ImprovementInitiative = {
  action: string;
  savings: number;              // ₹ savings/upside (positive = good)
  timeline: string;             // "0-3 months" etc.
  difficulty: "easy" | "medium" | "hard";
  rationale: string;
};

export type AnalysisResult = {
  period: string;
  monthsActual: number;
  plActual: PLResult;
  plAnnualized: PLResult;
  monthlyRevenue: Array<{ month: string; revenue: number }>;
  topCustomers: Array<{ name: string; amount: number }>;
  topVendors: Array<{ name: string; amount: number }>;
  countryRevenue: Array<{ country: string; amount: number }>;
  currencyRevenue: Array<{ currency: string; amount: number }>;
  totalAR: number;
  totalAP: number;
  glAccountCount: number;
  itemCategories: Array<{ category: string; quantity: number }>;
  variance: VarianceRow[];     // empty if no budget uploaded
  hasBudget: boolean;
  customerAging: AgingResult | null;
  vendorAging: AgingResult | null;
  cashFlow: CashFlowProjection | null;

  // Analytical layer (always computed when GL is available)
  insights: Insight[];
  criticalIssues: CriticalIssue[];
  growthOpportunities: GrowthOpportunity[];
  balanceSheet: BalanceSheet | null;
  costStructure: CostStructureRow[];
  benchmarks: BenchmarkRow[];
  improvements: ImprovementInitiative[];
  aiSummary: string;            // 2-3 paragraph natural-language summary
};

const TAX_RATE = 0.2517;

function classifyAccount(acct: string | number): string {
  const a = typeof acct === "number" ? acct : parseInt(String(acct), 10);
  if (isNaN(a)) return "Unclassified";
  if (a >= 1000 && a <= 1999) return "Fixed Assets";
  if (a >= 2000 && a <= 2199) return "Inventory";
  if (a >= 2200 && a <= 2399) return "Receivables";
  if (a >= 2400 && a <= 2799) return "Other Current Assets";
  if (a >= 2800 && a <= 2999) return "Cash & Bank";
  if (a >= 3000 && a <= 3999) return "Equity";
  if (a >= 4000 && a <= 4999) return "Long-Term Liabilities";
  if (a >= 5000 && a <= 5499) return "Trade Payables";
  if (a >= 5500 && a <= 5799) return "Tax Payables";
  if (a >= 5800 && a <= 5999) return "Statutory Payables";
  if (a >= 6000 && a <= 6999) return "Revenue";
  if (a >= 7000 && a <= 7999) return "COGS";
  if (a >= 8000 && a <= 8799) return "Operating Expenses";
  if (a >= 8800 && a <= 8899) return "Depreciation";
  if (a >= 8900 && a <= 8999) return "Other OpEx";
  if (a >= 9000 && a <= 9199) return "Other Income";
  if (a >= 9200 && a <= 9499) return "Other Expenses";
  if (a >= 9500 && a <= 9999) return "Finance Costs";
  return "Unclassified";
}

function parseDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v === "number") {
    // Excel serial date
    const date = XLSX.SSF.parse_date_code(v);
    if (date) return new Date(date.y, date.m - 1, date.d);
    return null;
  }
  if (typeof v === "string") {
    const d = new Date(v);
    if (!isNaN(d.getTime())) return d;
    const parts = v.split(/[-/]/);
    if (parts.length === 3) {
      const [a, b, c] = parts.map(Number);
      if (a > 1900) return new Date(a, b - 1, c);
      return new Date(c, b - 1, a);
    }
  }
  return null;
}

function fyOf(d: Date): string {
  const y = d.getFullYear();
  if (d.getMonth() + 1 >= FY_START_MONTH) {
    return `FY${String(y).slice(-2)}-${String(y + 1).slice(-2)}`;
  }
  return `FY${String(y - 1).slice(-2)}-${String(y).slice(-2)}`;
}

/**
 * Reads a sheet with header row at position headerRow (1-indexed).
 * Returns array of objects keyed by header names.
 */
function readSheet(
  buf: ArrayBuffer | Buffer,
  sheetName?: string,
  headerRow = 3
): Array<Record<string, any>> {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  const name = sheetName && wb.SheetNames.includes(sheetName) ? sheetName : wb.SheetNames[0];
  const ws = wb.Sheets[name];
  if (!ws) return [];
  const json = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, raw: true });
  if (json.length < headerRow) return [];
  const headers = json[headerRow - 1] as string[];
  const rows: Array<Record<string, any>> = [];
  for (let i = headerRow; i < json.length; i++) {
    const row = json[i];
    if (!row || row.every((c) => c === null || c === undefined || c === "")) continue;
    const rec: Record<string, any> = {};
    headers.forEach((h, idx) => {
      if (h) rec[h] = row[idx];
    });
    rows.push(rec);
  }
  return rows;
}

function emptyPL(): PLResult {
  return {
    revenue: 0, cogs: 0, grossProfit: 0, grossMargin: 0,
    operatingExpenses: 0, otherIncome: 0, otherExpenses: 0,
    ebitda: 0, ebitdaMargin: 0, depreciation: 0,
    ebit: 0, ebitMargin: 0, financeCosts: 0,
    pbt: 0, pbtMargin: 0, tax: 0, pat: 0, patMargin: 0,
  };
}

function buildPL(catTotals: Map<string, number>): PLResult {
  const revenue = -(catTotals.get("Revenue") || 0);
  const cogs = catTotals.get("COGS") || 0;
  const grossProfit = revenue - cogs;
  const operatingExpenses =
    (catTotals.get("Operating Expenses") || 0) + (catTotals.get("Other OpEx") || 0);
  const otherIncome = -(catTotals.get("Other Income") || 0);
  const otherExpenses = catTotals.get("Other Expenses") || 0;
  const ebitda = grossProfit - operatingExpenses + otherIncome - otherExpenses;
  const depreciation = catTotals.get("Depreciation") || 0;
  const ebit = ebitda - depreciation;
  const financeCosts = catTotals.get("Finance Costs") || 0;
  const pbt = ebit - financeCosts;
  const tax = pbt > 0 ? pbt * TAX_RATE : 0;
  const pat = pbt - tax;
  const m = (v: number) => (revenue ? (v / revenue) * 100 : 0);
  return {
    revenue, cogs, grossProfit, grossMargin: m(grossProfit),
    operatingExpenses, otherIncome, otherExpenses,
    ebitda, ebitdaMargin: m(ebitda),
    depreciation,
    ebit, ebitMargin: m(ebit),
    financeCosts,
    pbt, pbtMargin: m(pbt),
    tax, pat, patMargin: m(pat),
  };
}

export type ParsedFiles = {
  // Single-file (legacy) or multi-file (new) inputs; both supported.
  glBuffer?: ArrayBuffer | Buffer;
  salesBuffer?: ArrayBuffer | Buffer;
  purchaseBuffer?: ArrayBuffer | Buffer;
  inventoryBuffer?: ArrayBuffer | Buffer;
  glBuffers?: Array<ArrayBuffer | Buffer>;
  salesBuffers?: Array<ArrayBuffer | Buffer>;
  purchaseBuffers?: Array<ArrayBuffer | Buffer>;
  inventoryBuffers?: Array<ArrayBuffer | Buffer>;
  budgetBuffers?: Array<ArrayBuffer | Buffer>;
  customerAgingBuffers?: Array<ArrayBuffer | Buffer>;
  vendorAgingBuffers?: Array<ArrayBuffer | Buffer>;
};

// Heuristic mapping of common budget line-item names to P&L keys.
const INCOME_KEYS: Array<[RegExp, keyof PLResult]> = [
  [/\brev|sales\b|turnover|top[\s-]?line/i, "revenue"],
  [/gross\s*profit/i, "grossProfit"],
  [/other\s*income/i, "otherIncome"],
];
const EXPENSE_KEYS: Array<[RegExp, keyof PLResult]> = [
  [/\bcogs\b|cost\s*of\s*(goods|sales|sold)/i, "cogs"],
  [/operat(ing|ions)\s*(exp|cost)/i, "operatingExpenses"],
  [/opex/i, "operatingExpenses"],
  [/depreciat|amortis/i, "depreciation"],
  [/finance|interest/i, "financeCosts"],
  [/other\s*exp/i, "otherExpenses"],
  [/tax/i, "tax"],
];
const SUBTOTAL_KEYS: Array<[RegExp, keyof PLResult]> = [
  [/ebitda/i, "ebitda"],
  [/\bebit\b(?!da)/i, "ebit"],
  [/\bpbt\b|profit\s*before\s*tax/i, "pbt"],
  [/\bpat\b|profit\s*after\s*tax|net\s*profit/i, "pat"],
];

function pickColumns(rows: Array<Record<string, any>>): { itemCol?: string; budgetCol?: string; categoryCol?: string } {
  if (rows.length === 0) return {};
  const headers = Object.keys(rows[0] || {});
  let itemCol: string | undefined;
  let budgetCol: string | undefined;
  let categoryCol: string | undefined;
  for (const h of headers) {
    const lh = String(h).toLowerCase().trim();
    if (!itemCol && /(line\s*item|particular|account|head|description|name|item)/.test(lh)) itemCol = h;
    if (!budgetCol && /(budget|plan|target|projection)/.test(lh) && /(amount|amt|value|inr|rs|cr|lakh|fy)/.test(lh)) budgetCol = h;
    if (!budgetCol && /^budget$/i.test(lh)) budgetCol = h;
    if (!categoryCol && /(type|category|nature|kind|class)/.test(lh)) categoryCol = h;
  }
  // Fallback: pick the first numeric column as budget
  if (!budgetCol) {
    for (const h of headers) {
      const sample = rows.slice(0, 10).map((r) => r[h]).find((v) => typeof v === "number" || (typeof v === "string" && /^[\d,.()-]+$/.test(v.trim())));
      if (sample !== undefined) { budgetCol = h; break; }
    }
  }
  if (!itemCol) {
    for (const h of headers) {
      if (h !== budgetCol) { itemCol = h; break; }
    }
  }
  return { itemCol, budgetCol, categoryCol };
}

function toNum(v: any): number {
  if (typeof v === "number") return v;
  if (typeof v !== "string") return 0;
  const s = v.replace(/[^0-9.()-]/g, "");
  const neg = /^\(/.test(s);
  const n = parseFloat(s.replace(/[()]/g, ""));
  if (!isFinite(n)) return 0;
  return neg ? -n : n;
}

function parseBudget(
  bufs: Array<ArrayBuffer | Buffer> | undefined,
  actual: PLResult
): VarianceRow[] {
  if (!bufs || bufs.length === 0) return [];
  const allRows: Array<Record<string, any>> = [];
  for (const b of bufs) {
    let rows = readSheet(b, undefined, 3);
    if (rows.length === 0) rows = readSheet(b, undefined, 1);
    allRows.push(...rows);
  }
  if (allRows.length === 0) return [];
  const { itemCol, budgetCol, categoryCol } = pickColumns(allRows);
  if (!itemCol || !budgetCol) return [];

  // Aggregate by line item (in case duplicates)
  const byItem = new Map<string, { kind?: "income" | "expense"; amount: number }>();
  for (const r of allRows) {
    const name = String(r[itemCol] ?? "").trim();
    if (!name) continue;
    const amt = toNum(r[budgetCol]);
    if (!amt) continue;
    const cat = categoryCol ? String(r[categoryCol] ?? "").toLowerCase() : "";
    let kind: "income" | "expense" | undefined;
    if (/income|revenue|sales|gain/.test(cat)) kind = "income";
    else if (/expen|cost|cogs|tax/.test(cat)) kind = "expense";
    const cur = byItem.get(name) || { amount: 0, kind };
    cur.amount += amt;
    if (!cur.kind && kind) cur.kind = kind;
    byItem.set(name, cur);
  }

  const out: VarianceRow[] = [];
  for (const [name, { amount, kind: hintedKind }] of byItem.entries()) {
    // Match to a P&L line
    let plKey: keyof PLResult | undefined;
    let kind: "income" | "expense" = hintedKind ?? "expense";

    for (const [rx, key] of INCOME_KEYS) {
      if (rx.test(name)) { plKey = key; kind = "income"; break; }
    }
    if (!plKey) {
      for (const [rx, key] of EXPENSE_KEYS) {
        if (rx.test(name)) { plKey = key; kind = "expense"; break; }
      }
    }
    if (!plKey) {
      for (const [rx, key] of SUBTOTAL_KEYS) {
        if (rx.test(name)) {
          plKey = key;
          // PAT/PBT/EBITDA/EBIT — treat as income-side (higher = better)
          kind = "income";
          break;
        }
      }
    }

    const actualVal = plKey ? Number((actual as any)[plKey] ?? 0) : 0;
    const variance = actualVal - amount;
    const variancePct = amount ? (variance / Math.abs(amount)) * 100 : 0;
    const favorable = kind === "income" ? variance >= 0 : variance <= 0;
    out.push({
      lineItem: name,
      kind,
      budget: amount,
      actual: actualVal,
      variance,
      variancePct,
      favorable,
    });
  }

  // Sort: income first, then by absolute variance descending
  out.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "income" ? -1 : 1;
    return Math.abs(b.variance) - Math.abs(a.variance);
  });
  return out;
}

// Read same sheet from multiple workbooks and concatenate rows.
function readSheets(
  bufs: Array<ArrayBuffer | Buffer> | undefined,
  sheetName?: string,
  headerRow = 3
): Array<Record<string, any>> {
  if (!bufs || bufs.length === 0) return [];
  const out: Array<Record<string, any>> = [];
  for (const b of bufs) {
    const rows = readSheet(b, sheetName, headerRow);
    // If first try yields nothing, try header on row 1 (some ERPs export with no metadata header)
    if (rows.length === 0 && headerRow !== 1) {
      out.push(...readSheet(b, sheetName, 1));
    } else {
      out.push(...rows);
    }
  }
  return out;
}

// -------- Aging parser (Customer / Vendor) --------

const BUCKET_PATTERNS: Array<[RegExp, AgingBucket]> = [
  [/^current$|^not\s*due$/i, "Current"],
  [/^0[\s-]*30$|^<=?\s*30$|^upto\s*30/i, "0-30"],
  [/^31[\s-]*60$|^>30.*<=?60/i, "31-60"],
  [/^61[\s-]*90$|^>60.*<=?90/i, "61-90"],
  [/^91[\s-]*180$|^>90.*<=?180/i, "91-180"],
  [/^180\+$|^>180|^over\s*180/i, "180+"],
];

function findCol(headers: string[], patterns: RegExp[]): string | undefined {
  for (const h of headers) {
    const lh = String(h).toLowerCase().trim();
    if (patterns.some((p) => p.test(lh))) return h;
  }
  return undefined;
}

function bucketize(daysOverdue: number): AgingBucket {
  if (daysOverdue <= 0) return "Current";
  if (daysOverdue <= 30) return "0-30";
  if (daysOverdue <= 60) return "31-60";
  if (daysOverdue <= 90) return "61-90";
  if (daysOverdue <= 180) return "91-180";
  return "180+";
}

function emptyBuckets(): Record<AgingBucket, number> {
  return { Current: 0, "0-30": 0, "31-60": 0, "61-90": 0, "91-180": 0, "180+": 0 };
}

/**
 * Parse aging file. Supports two shapes:
 *  A) party + bucket columns
 *  B) invoice-level with dates (compute aging vs asOf)
 */
function parseAging(
  bufs: Array<ArrayBuffer | Buffer> | undefined,
  asOf: Date
): AgingResult | null {
  if (!bufs || bufs.length === 0) return null;
  const allRows: Array<Record<string, any>> = [];
  for (const b of bufs) {
    let rows = readSheet(b, undefined, 3);
    if (rows.length === 0) rows = readSheet(b, undefined, 1);
    allRows.push(...rows);
  }
  if (allRows.length === 0) return null;

  const headers = Object.keys(allRows[0] || {});
  const partyCol = findCol(headers, [
    /customer|vendor|party|account|name|debtor|creditor|supplier/i,
  ]);
  if (!partyCol) return null;

  // Detect Shape A: bucket columns
  const bucketCols: Array<{ header: string; bucket: AgingBucket }> = [];
  for (const h of headers) {
    const norm = String(h).toLowerCase().trim().replace(/\s+/g, "");
    for (const [pat, bk] of BUCKET_PATTERNS) {
      if (pat.test(norm)) {
        bucketCols.push({ header: h, bucket: bk });
        break;
      }
    }
  }

  const buckets = emptyBuckets();
  const partyTotals = new Map<string, { amount: number; topBucket: AgingBucket; daysOverdue?: number }>();
  let totalOutstanding = 0;

  if (bucketCols.length >= 2) {
    // SHAPE A — bucket columns
    for (const r of allRows) {
      const name = String(r[partyCol] ?? "").trim();
      if (!name) continue;
      let partyAmt = 0;
      let worstBucket: AgingBucket = "Current";
      for (const { header, bucket } of bucketCols) {
        const v = toNum(r[header]);
        if (v) {
          buckets[bucket] += v;
          partyAmt += v;
          totalOutstanding += v;
          // track worst (rightmost) bucket
          if (AGING_BUCKETS.indexOf(bucket) > AGING_BUCKETS.indexOf(worstBucket)) {
            worstBucket = bucket;
          }
        }
      }
      if (partyAmt) {
        const cur = partyTotals.get(name);
        if (cur) {
          cur.amount += partyAmt;
          if (
            AGING_BUCKETS.indexOf(worstBucket) > AGING_BUCKETS.indexOf(cur.topBucket)
          )
            cur.topBucket = worstBucket;
        } else {
          partyTotals.set(name, { amount: partyAmt, topBucket: worstBucket });
        }
      }
    }
  } else {
    // SHAPE B — invoice-level dates
    const amtCol = findCol(headers, [
      /amount|outstanding|balance|due|net/i,
    ]);
    const dueCol = findCol(headers, [/due\s*date/i]);
    const invCol = findCol(headers, [/invoice\s*date|bill\s*date|posting\s*date|document\s*date/i]);
    if (!amtCol) return null;

    for (const r of allRows) {
      const name = String(r[partyCol] ?? "").trim();
      if (!name) continue;
      const amt = toNum(r[amtCol]);
      if (!amt) continue;
      const refDate = parseDate(r[dueCol || ""]) || parseDate(r[invCol || ""]);
      const daysOverdue = refDate ? Math.floor((asOf.getTime() - refDate.getTime()) / 86_400_000) : 0;
      const bk = bucketize(daysOverdue);
      buckets[bk] += amt;
      totalOutstanding += amt;
      const cur = partyTotals.get(name);
      if (cur) {
        cur.amount += amt;
        if (AGING_BUCKETS.indexOf(bk) > AGING_BUCKETS.indexOf(cur.topBucket)) {
          cur.topBucket = bk;
          cur.daysOverdue = daysOverdue;
        }
      } else {
        partyTotals.set(name, { amount: amt, topBucket: bk, daysOverdue });
      }
    }
  }

  const topParties = [...partyTotals.entries()]
    .map(([name, v]) => ({ name, amount: v.amount, bucket: v.topBucket, daysOverdue: v.daysOverdue }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 10);

  return {
    asOfDate: asOf.toISOString().slice(0, 10),
    totalOutstanding,
    buckets,
    topParties,
    partyCount: partyTotals.size,
  };
}

function buildCashFlow(
  ar: AgingResult | null,
  ap: AgingResult | null
): CashFlowProjection | null {
  if (!ar && !ap) return null;
  // Expected-collections heuristic: a bucket's amount is expected in its window.
  // Current → next 30 days, 0-30 → already overdue, expected within next 30 days too, etc.
  // Past-due buckets are weighted by realistic recovery rates.
  const collect = (a: AgingResult | null): Record<string, number> => {
    if (!a) return { "0-30": 0, "31-60": 0, "61-90": 0 };
    // For receivables: Current + 0-30 collected in next 30; 31-60 in next 60; 61-90 in next 90 (partial)
    return {
      "0-30": (a.buckets.Current || 0) + (a.buckets["0-30"] || 0) * 0.9,
      "31-60": (a.buckets["31-60"] || 0) * 0.7,
      "61-90": (a.buckets["61-90"] || 0) * 0.5,
    };
  };
  const pay = (a: AgingResult | null): Record<string, number> => {
    if (!a) return { "0-30": 0, "31-60": 0, "61-90": 0 };
    // For payables: Current + 0-30 due in next 30; 31-60 must be paid in next 60 etc.
    return {
      "0-30": (a.buckets.Current || 0) + (a.buckets["0-30"] || 0),
      "31-60": (a.buckets["31-60"] || 0),
      "61-90": (a.buckets["61-90"] || 0),
    };
  };
  const c = collect(ar);
  const p = pay(ap);
  const windows = [
    { label: "Next 30 days", collections: c["0-30"], payments: p["0-30"], net: c["0-30"] - p["0-30"] },
    { label: "31-60 days", collections: c["31-60"], payments: p["31-60"], net: c["31-60"] - p["31-60"] },
    { label: "61-90 days", collections: c["61-90"], payments: p["61-90"], net: c["61-90"] - p["61-90"] },
  ];
  const totalCollections = windows.reduce((s, w) => s + w.collections, 0);
  const totalPayments = windows.reduce((s, w) => s + w.payments, 0);
  return {
    windows,
    totalCollections,
    totalPayments,
    netCashFlow: totalCollections - totalPayments,
  };
}

// ========================================================================
// AI-style analytics engine — auto-generates insights, issues, opportunities
// ========================================================================

// Industry benchmarks (general manufacturing / SME — tune later per industry)
const BENCHMARKS = {
  grossMarginGood: 35,        // %
  grossMarginPoor: 25,
  ebitdaMarginGood: 10,
  ebitdaMarginPoor: 5,
  patMarginGood: 5,
  dsoGood: 45,                // days
  dsoPoor: 75,
  dpoGood: 45,
  dpoPoor: 90,
  currentRatioGood: 1.5,
  currentRatioPoor: 1.0,
  customerConcentrationWarn: 30,   // % of top customer
  vendorConcentrationWarn: 30,
  opexLineWarn: 5,            // any opex line > 5% of revenue
};

function fmtCr(v: number): string {
  const cr = v / 1e7;
  const sign = cr < 0 ? "−" : "";
  return `${sign}₹${Math.abs(cr).toFixed(2)} Cr`;
}

function fmtPct(v: number, digits = 1): string {
  const sign = v < 0 ? "−" : "";
  return `${sign}${Math.abs(v).toFixed(digits)}%`;
}

function computeBalanceSheet(
  fyAcctTotals: Map<string, Map<string, number>>
): BalanceSheet {
  // Sum across all FYs (running balances)
  const totals = new Map<string, number>();
  for (const acctMap of fyAcctTotals.values()) {
    for (const [acct, v] of acctMap.entries()) {
      totals.set(acct, (totals.get(acct) || 0) + v);
    }
  }
  const inRange = (lo: number, hi: number) => {
    let sum = 0;
    for (const [acct, v] of totals.entries()) {
      const a = parseInt(String(acct), 10);
      if (!isNaN(a) && a >= lo && a <= hi) sum += v;
    }
    return sum;
  };
  const fixedAssetsNet = inRange(1000, 1999);
  const inventory = inRange(2000, 2199);
  const receivables = inRange(2200, 2399);
  const otherAssets = inRange(2400, 2799);
  const cashAndBank = inRange(2800, 2999);
  const totalAssets = fixedAssetsNet + inventory + receivables + otherAssets + cashAndBank;

  const equity = -inRange(3000, 3999);
  const longTermDebt = -inRange(4000, 4999);
  const payables = -inRange(5000, 5499);
  const otherCurrentLiab = -inRange(5500, 5999);
  const totalLiabilitiesAndEquity = equity + longTermDebt + payables + otherCurrentLiab;

  const currentAssets = inventory + receivables + otherAssets + cashAndBank;
  const currentLiabilities = payables + otherCurrentLiab;
  const currentRatio = currentLiabilities ? currentAssets / currentLiabilities : 0;
  const debtToEquity = equity ? longTermDebt / equity : 0;

  return {
    fixedAssetsNet, inventory, receivables, cashAndBank, otherAssets, totalAssets,
    equity, longTermDebt, payables, otherCurrentLiab, totalLiabilitiesAndEquity,
    currentRatio, debtToEquity,
  };
}

function computeCostStructure(
  fyAcctTotals: Map<string, Map<string, number>>,
  targetFY: string,
  revenue: number
): CostStructureRow[] {
  const acctMap = fyAcctTotals.get(targetFY) || new Map();
  // Build a category map from account ranges in 7xxx + 8xxx
  const buckets: Array<{ name: string; range: [number, number] }> = [
    { name: "Raw Material / Direct Cost", range: [7000, 7299] },
    { name: "Other Direct Costs", range: [7300, 7999] },
    { name: "Salaries & Personnel", range: [8100, 8199] },
    { name: "Office & Admin", range: [8200, 8299] },
    { name: "Sales & Marketing", range: [8300, 8399] },
    { name: "Legal & Professional", range: [8400, 8499] },
    { name: "Utilities & Communications", range: [8500, 8599] },
    { name: "Travel & Conveyance", range: [8600, 8699] },
    { name: "Other Operating Expenses", range: [8700, 8799] },
    { name: "Depreciation & Amortization", range: [8800, 8899] },
    { name: "Miscellaneous OpEx", range: [8900, 8999] },
    { name: "Finance Costs", range: [9500, 9999] },
  ];
  const rows: CostStructureRow[] = [];
  for (const b of buckets) {
    let sum = 0;
    for (const [acct, v] of acctMap.entries()) {
      const a = parseInt(String(acct), 10);
      if (!isNaN(a) && a >= b.range[0] && a <= b.range[1]) sum += v;
    }
    if (Math.abs(sum) < 1) continue; // skip empty
    const pct = revenue ? (sum / revenue) * 100 : 0;
    rows.push({
      category: b.name,
      amount: sum,
      percentOfRevenue: pct,
      isWatchlist: pct > BENCHMARKS.opexLineWarn,
      benchmark:
        pct > BENCHMARKS.opexLineWarn
          ? `Above ${BENCHMARKS.opexLineWarn}% threshold — review`
          : undefined,
    });
  }
  return rows.sort((a, b) => b.amount - a.amount);
}

function computeBenchmarks(
  pl: PLResult,
  bs: BalanceSheet | null,
  customerAging: AgingResult | null,
  vendorAging: AgingResult | null,
  annualCOGS: number
): BenchmarkRow[] {
  const rows: BenchmarkRow[] = [];
  // Gross margin
  rows.push({
    metric: "Gross Margin",
    actual: fmtPct(pl.grossMargin),
    actualNumeric: pl.grossMargin,
    benchmark: `${BENCHMARKS.grossMarginPoor}–${BENCHMARKS.grossMarginGood}%`,
    status:
      pl.grossMargin >= BENCHMARKS.grossMarginGood ? "good"
      : pl.grossMargin >= BENCHMARKS.grossMarginPoor ? "ok"
      : "poor",
    gap:
      pl.grossMargin < BENCHMARKS.grossMarginGood
        ? `${(BENCHMARKS.grossMarginGood - pl.grossMargin).toFixed(1)}pp below target`
        : "At or above target",
  });
  // EBITDA margin
  rows.push({
    metric: "EBITDA Margin",
    actual: fmtPct(pl.ebitdaMargin),
    actualNumeric: pl.ebitdaMargin,
    benchmark: `${BENCHMARKS.ebitdaMarginPoor}–${BENCHMARKS.ebitdaMarginGood}%`,
    status:
      pl.ebitdaMargin >= BENCHMARKS.ebitdaMarginGood ? "good"
      : pl.ebitdaMargin >= BENCHMARKS.ebitdaMarginPoor ? "ok"
      : "poor",
    gap:
      pl.ebitdaMargin < BENCHMARKS.ebitdaMarginGood
        ? `${(BENCHMARKS.ebitdaMarginGood - pl.ebitdaMargin).toFixed(1)}pp below target`
        : "At or above target",
  });
  // PAT margin
  rows.push({
    metric: "Net Margin (PAT)",
    actual: fmtPct(pl.patMargin),
    actualNumeric: pl.patMargin,
    benchmark: `≥ ${BENCHMARKS.patMarginGood}%`,
    status: pl.patMargin >= BENCHMARKS.patMarginGood ? "good" : pl.patMargin >= 0 ? "ok" : "poor",
    gap: pl.patMargin < 0 ? "Company operating at a loss" : pl.patMargin < BENCHMARKS.patMarginGood ? `${(BENCHMARKS.patMarginGood - pl.patMargin).toFixed(1)}pp below target` : "At or above target",
  });
  // DSO
  if (pl.revenue && customerAging) {
    const dso = (customerAging.totalOutstanding / pl.revenue) * 365;
    rows.push({
      metric: "DSO (Days Sales Outstanding)",
      actual: `${dso.toFixed(0)} days`,
      actualNumeric: dso,
      benchmark: `${BENCHMARKS.dsoGood}–${BENCHMARKS.dsoPoor} days`,
      status: dso <= BENCHMARKS.dsoGood ? "good" : dso <= BENCHMARKS.dsoPoor ? "ok" : "poor",
      gap: dso > BENCHMARKS.dsoGood ? `${(dso - BENCHMARKS.dsoGood).toFixed(0)} days above target` : "Within target",
    });
  } else if (bs && pl.revenue) {
    const dso = (bs.receivables / pl.revenue) * 365;
    rows.push({
      metric: "DSO (Days Sales Outstanding)",
      actual: `${dso.toFixed(0)} days`,
      actualNumeric: dso,
      benchmark: `${BENCHMARKS.dsoGood}–${BENCHMARKS.dsoPoor} days`,
      status: dso <= BENCHMARKS.dsoGood ? "good" : dso <= BENCHMARKS.dsoPoor ? "ok" : "poor",
      gap: dso > BENCHMARKS.dsoGood ? `${(dso - BENCHMARKS.dsoGood).toFixed(0)} days above target` : "Within target",
    });
  }
  // DPO
  if (annualCOGS && vendorAging) {
    const dpo = (vendorAging.totalOutstanding / annualCOGS) * 365;
    rows.push({
      metric: "DPO (Days Payables Outstanding)",
      actual: `${dpo.toFixed(0)} days`,
      actualNumeric: dpo,
      benchmark: `${BENCHMARKS.dpoGood}–${BENCHMARKS.dpoPoor} days`,
      status:
        dpo >= BENCHMARKS.dpoGood && dpo <= BENCHMARKS.dpoPoor
          ? "good"
          : dpo < BENCHMARKS.dpoGood
          ? "ok"
          : "poor",
      gap:
        dpo > BENCHMARKS.dpoPoor
          ? `${(dpo - BENCHMARKS.dpoPoor).toFixed(0)} days above range — vendor relationship risk`
          : dpo < BENCHMARKS.dpoGood
          ? `${(BENCHMARKS.dpoGood - dpo).toFixed(0)} days below range — could extend terms`
          : "Within range",
    });
  } else if (bs && annualCOGS) {
    const dpo = (bs.payables / annualCOGS) * 365;
    rows.push({
      metric: "DPO (Days Payables Outstanding)",
      actual: `${dpo.toFixed(0)} days`,
      actualNumeric: dpo,
      benchmark: `${BENCHMARKS.dpoGood}–${BENCHMARKS.dpoPoor} days`,
      status:
        dpo >= BENCHMARKS.dpoGood && dpo <= BENCHMARKS.dpoPoor
          ? "good"
          : dpo < BENCHMARKS.dpoGood
          ? "ok"
          : "poor",
      gap:
        dpo > BENCHMARKS.dpoPoor
          ? `${(dpo - BENCHMARKS.dpoPoor).toFixed(0)} days above range`
          : dpo < BENCHMARKS.dpoGood
          ? `${(BENCHMARKS.dpoGood - dpo).toFixed(0)} days below range`
          : "Within range",
    });
  }
  // Current ratio
  if (bs && bs.currentRatio) {
    rows.push({
      metric: "Current Ratio",
      actual: `${bs.currentRatio.toFixed(2)}x`,
      actualNumeric: bs.currentRatio,
      benchmark: `≥ ${BENCHMARKS.currentRatioGood}x`,
      status:
        bs.currentRatio >= BENCHMARKS.currentRatioGood
          ? "good"
          : bs.currentRatio >= BENCHMARKS.currentRatioPoor
          ? "ok"
          : "poor",
      gap:
        bs.currentRatio < BENCHMARKS.currentRatioGood
          ? `${(BENCHMARKS.currentRatioGood - bs.currentRatio).toFixed(2)}x below target — limited liquidity buffer`
          : "Adequate liquidity",
    });
  }
  return rows;
}

function detectCriticalIssues(
  pl: PLResult,
  benchmarks: BenchmarkRow[],
  topCustomers: Array<{ name: string; amount: number }>,
  topVendors: Array<{ name: string; amount: number }>,
  bs: BalanceSheet | null
): CriticalIssue[] {
  const issues: CriticalIssue[] = [];

  // 1) Operating loss
  if (pl.ebit < 0) {
    issues.push({
      rank: 0,
      title: "Operating Loss — Costs Exceed Operating Income",
      rootCause: `EBIT is negative at ${fmtCr(pl.ebit)} (${fmtPct(pl.ebitMargin)} margin). Operating expenses (${fmtCr(pl.operatingExpenses)}) plus depreciation (${fmtCr(pl.depreciation)}) outweigh gross profit.`,
      recommendedAction: "Cut top operating expense lines; renegotiate top supplier contracts; review fixed-cost base.",
      potentialImpact: `Closing the EBIT gap would unlock ${fmtCr(Math.abs(pl.ebit))} in annual operating profit.`,
      severity: "high",
    });
  }
  // 2) Thin EBITDA margin
  if (pl.ebitda > 0 && pl.ebitdaMargin < BENCHMARKS.ebitdaMarginGood) {
    issues.push({
      rank: 0,
      title: "EBITDA Margin Below Industry Benchmark",
      rootCause: `EBITDA margin at ${fmtPct(pl.ebitdaMargin)} vs industry target of ${BENCHMARKS.ebitdaMarginGood}%+. Buffer for cost shocks is thin.`,
      recommendedAction: "Identify top 3 OpEx lines as % of revenue and target 10-20% reduction in each.",
      potentialImpact: `Each 1pp of EBITDA margin = ${fmtCr(pl.revenue * 0.01)} annual profit.`,
      severity: "high",
    });
  }
  // 3) Gross margin gap
  if (pl.grossMargin < BENCHMARKS.grossMarginGood) {
    issues.push({
      rank: 0,
      title: `Gross Margin at ${fmtPct(pl.grossMargin)} — Below ${BENCHMARKS.grossMarginGood}% Target`,
      rootCause: `Gross margin gap of ${(BENCHMARKS.grossMarginGood - pl.grossMargin).toFixed(1)}pp. Driven by COGS at ${fmtPct((pl.cogs / pl.revenue) * 100)} of revenue.`,
      recommendedAction: "Review pricing on top SKUs; consolidate raw material vendors for volume discount; pass-through input cost increases.",
      potentialImpact: `Each 1pp of gross margin gain = ${fmtCr(pl.revenue * 0.01)} additional gross profit.`,
      severity: pl.grossMargin < BENCHMARKS.grossMarginPoor ? "high" : "medium",
    });
  }
  // 4) DSO too high
  const dsoRow = benchmarks.find((b) => b.metric.startsWith("DSO"));
  if (dsoRow && dsoRow.actualNumeric > BENCHMARKS.dsoPoor) {
    const cashLocked = (dsoRow.actualNumeric - BENCHMARKS.dsoGood) / 365 * pl.revenue;
    issues.push({
      rank: 0,
      title: `Slow Collections — DSO at ${dsoRow.actual}`,
      rootCause: `Receivables conversion is taking ${dsoRow.actual} vs industry target of ${BENCHMARKS.dsoGood} days. Cash is tied up in receivables.`,
      recommendedAction: "Tighten credit terms; offer early-payment discounts; assign dedicated collections owner for accounts > 60 days.",
      potentialImpact: `Reducing DSO to ${BENCHMARKS.dsoGood} days would release ${fmtCr(cashLocked)} in working capital.`,
      severity: "high",
    });
  }
  // 5) Customer concentration
  if (topCustomers.length > 0) {
    const totalTop = topCustomers.reduce((s, c) => s + c.amount, 0);
    if (totalTop > 0) {
      const topShare = (topCustomers[0]!.amount / totalTop) * 100;
      if (topShare > BENCHMARKS.customerConcentrationWarn) {
        issues.push({
          rank: 0,
          title: "Customer Concentration Risk",
          rootCause: `Top customer "${topCustomers[0]!.name}" accounts for ${topShare.toFixed(1)}% of invoice value in the sample. High dependency on a single account.`,
          recommendedAction: "Diversify customer base; cap any single customer at < 20% of revenue; target adjacent segments.",
          potentialImpact: "Reducing concentration de-risks ${fmtCr(topCustomers[0]!.amount)} of revenue.",
          severity: topShare > 50 ? "high" : "medium",
        });
      }
    }
  }
  // 6) Working capital tight
  if (bs && bs.currentRatio && bs.currentRatio < BENCHMARKS.currentRatioGood) {
    issues.push({
      rank: 0,
      title: `Current Ratio at ${bs.currentRatio.toFixed(2)}x — Liquidity Pressure`,
      rootCause: `Current ratio below ${BENCHMARKS.currentRatioGood}x benchmark. Current liabilities of ${fmtCr(bs.payables + bs.otherCurrentLiab)} approach current assets of ${fmtCr(bs.inventory + bs.receivables + bs.cashAndBank + bs.otherAssets)}.`,
      recommendedAction: "Secure working capital line; extend supplier payment terms; accelerate receivables.",
      potentialImpact: `Bringing ratio to ${BENCHMARKS.currentRatioGood}x requires net working capital improvement of ${fmtCr((BENCHMARKS.currentRatioGood - bs.currentRatio) * (bs.payables + bs.otherCurrentLiab))}.`,
      severity: bs.currentRatio < BENCHMARKS.currentRatioPoor ? "high" : "medium",
    });
  }
  // Rank by severity
  const sev = { high: 0, medium: 1, low: 2, info: 3 };
  issues.sort((a, b) => sev[a.severity] - sev[b.severity]);
  issues.forEach((it, i) => (it.rank = i + 1));
  return issues.slice(0, 5);
}

function suggestGrowthOpportunities(
  pl: PLResult,
  topCustomers: Array<{ name: string; amount: number }>,
  countryRevenue: Array<{ country: string; amount: number }>,
  itemCategories: Array<{ category: string; quantity: number }>,
  monthlyRevenue: Array<{ month: string; revenue: number }>
): GrowthOpportunity[] {
  const opps: GrowthOpportunity[] = [];

  // 1) Replicate top customer profile
  if (topCustomers.length >= 3) {
    const top3Total = topCustomers.slice(0, 3).reduce((s, c) => s + c.amount, 0);
    opps.push({
      rank: 1,
      title: "Replicate Top Customer Profile",
      rationale: `Top 3 customers (${topCustomers.slice(0, 3).map((c) => c.name).join(", ")}) generated ${fmtCr(top3Total)}. They share a winning profile (size, geography, use-case).`,
      approach: "Map common attributes of these accounts (industry, size, region) and run targeted outreach to look-alikes.",
      potentialUpside: `Each additional similar account = ${fmtCr(top3Total / 3)} potential revenue.`,
    });
  }

  // 2) Geographic expansion
  if (countryRevenue.length >= 2) {
    const dominant = countryRevenue[0]!;
    const totalRev = countryRevenue.reduce((s, c) => s + c.amount, 0);
    const share = totalRev ? (dominant.amount / totalRev) * 100 : 0;
    if (share < 70) {
      opps.push({
        rank: 2,
        title: "Geographic Expansion",
        rationale: `Revenue is spread across ${countryRevenue.length} countries with no single market dominating (top market ${dominant.country} at ${share.toFixed(0)}%). Diversification is already proven.`,
        approach: `Double down on the next 2-3 emerging markets (${countryRevenue.slice(1, 4).map((c) => c.country).join(", ")}) where you already have a footprint.`,
        potentialUpside: "Doubling revenue in #2-3 markets could add ₹{X} Cr annually.",
      });
    }
  }

  // 3) Push high-margin item category
  if (itemCategories.length >= 2) {
    const topCat = itemCategories[0]!;
    opps.push({
      rank: 3,
      title: `Scale "${topCat.category}" Product Line`,
      rationale: `${topCat.category} is the leading category by volume (${topCat.quantity.toLocaleString()} units sold). High existing demand suggests room to add SKUs.`,
      approach: "Add 2-3 SKUs in this category; cross-sell to existing customers; bundle with related products.",
      potentialUpside: "Cross-sell of even 20% of existing customers can lift category revenue by 30-50%.",
    });
  }

  // 4) Capture revenue momentum
  if (monthlyRevenue.length >= 6) {
    const first = monthlyRevenue[0]!.revenue;
    const last = monthlyRevenue.filter((m) => m.revenue > 1000).slice(-1)[0]?.revenue || first;
    const growth = first ? ((last / first) - 1) * 100 : 0;
    if (growth > 30) {
      opps.push({
        rank: 4,
        title: "Lock In Revenue Momentum",
        rationale: `Monthly revenue grew ${growth.toFixed(0)}% from start to latest month. Demand signal is strong.`,
        approach: "Invest in production capacity now; sign long-term contracts with growing customers; pre-empt seasonality.",
        potentialUpside: `Sustaining ${growth.toFixed(0)}% growth for another quarter = ${fmtCr(last * 3 * (growth / 100))} additional revenue.`,
      });
    }
  }

  return opps.slice(0, 4);
}

function generateInsights(
  pl: PLResult,
  pla: PLResult,
  monthlyRevenue: Array<{ month: string; revenue: number }>,
  totalAR: number,
  totalAP: number,
  topCustomers: Array<{ name: string; amount: number }>
): Insight[] {
  const insights: Insight[] = [];
  // Revenue trajectory
  if (monthlyRevenue.length >= 3) {
    const first = monthlyRevenue[0]!.revenue;
    const last = monthlyRevenue.filter((m) => m.revenue > 1000).slice(-1)[0]?.revenue || first;
    const growth = first ? ((last / first) - 1) * 100 : 0;
    insights.push({
      category: "revenue",
      title: `Revenue ${growth >= 0 ? "grew" : "declined"} ${Math.abs(growth).toFixed(0)}% over the period`,
      detail: `Monthly run-rate moved from ${fmtCr(first)} to ${fmtCr(last)}. ${growth > 30 ? "Strong demand signal." : growth > 0 ? "Steady, modest growth." : "Watch for headwinds."}`,
      severity: growth > 30 ? "info" : growth > 0 ? "low" : "medium",
    });
  }
  // Margin commentary
  insights.push({
    category: "margin",
    title: `Gross margin at ${fmtPct(pl.grossMargin)}`,
    detail:
      pl.grossMargin >= BENCHMARKS.grossMarginGood
        ? `Above industry target (${BENCHMARKS.grossMarginGood}%+) — pricing and sourcing are working.`
        : pl.grossMargin >= BENCHMARKS.grossMarginPoor
        ? `Within acceptable range but ${(BENCHMARKS.grossMarginGood - pl.grossMargin).toFixed(1)}pp below best-in-class.`
        : `Below ${BENCHMARKS.grossMarginPoor}% — pricing power and input cost discipline both need work.`,
    severity:
      pl.grossMargin >= BENCHMARKS.grossMarginGood ? "info"
      : pl.grossMargin >= BENCHMARKS.grossMarginPoor ? "low"
      : "high",
  });
  // EBITDA
  insights.push({
    category: "margin",
    title: `EBITDA ${pl.ebitda >= 0 ? "positive" : "negative"} at ${fmtCr(pl.ebitda)}`,
    detail:
      pl.ebitda < 0
        ? "Operating costs exceed gross profit. Top OpEx lines need immediate attention."
        : pl.ebitdaMargin < BENCHMARKS.ebitdaMarginGood
        ? `Margin of ${fmtPct(pl.ebitdaMargin)} is below the ${BENCHMARKS.ebitdaMarginGood}% benchmark. Limited cushion for cost shocks.`
        : `Margin of ${fmtPct(pl.ebitdaMargin)} is healthy — sustainable cash generation.`,
    severity: pl.ebitda < 0 ? "high" : pl.ebitdaMargin < BENCHMARKS.ebitdaMarginGood ? "medium" : "info",
  });
  // Cash position
  if (totalAR && totalAP) {
    const nwc = totalAR - totalAP;
    insights.push({
      category: "cashflow",
      title: `Net working capital deployed: ${fmtCr(nwc)}`,
      detail:
        nwc > 0
          ? `Receivables (${fmtCr(totalAR)}) exceed payables (${fmtCr(totalAP)}). Cash is funding the working capital cycle.`
          : `Payables (${fmtCr(totalAP)}) exceed receivables (${fmtCr(totalAR)}) — suppliers are funding operations.`,
      severity: Math.abs(nwc) > pl.revenue * 0.2 ? "medium" : "info",
    });
  }
  // Customer concentration
  if (topCustomers.length > 0) {
    const total = topCustomers.reduce((s, c) => s + c.amount, 0);
    const topShare = total ? (topCustomers[0]!.amount / total) * 100 : 0;
    if (topShare > BENCHMARKS.customerConcentrationWarn) {
      insights.push({
        category: "concentration",
        title: `Top customer accounts for ${topShare.toFixed(0)}% of sampled invoices`,
        detail: `${topCustomers[0]!.name} dominates the customer base. Single point of failure if relationship sours.`,
        severity: topShare > 50 ? "high" : "medium",
      });
    }
  }
  // PAT
  if (pl.pat < 0) {
    insights.push({
      category: "margin",
      title: `Net loss of ${fmtCr(Math.abs(pl.pat))}`,
      detail: "Path to profitability requires either revenue growth, gross margin expansion, or OpEx reduction. Detailed action items follow.",
      severity: "high",
    });
  }
  return insights;
}

function buildImprovements(
  pl: PLResult,
  bs: BalanceSheet | null,
  costStructure: CostStructureRow[],
  benchmarks: BenchmarkRow[]
): ImprovementInitiative[] {
  const items: ImprovementInitiative[] = [];

  // 1) Cut top 1-2 watchlist opex lines by 20%
  const watch = costStructure.filter((c) => c.isWatchlist).slice(0, 3);
  for (const w of watch) {
    items.push({
      action: `Reduce ${w.category} by 20%`,
      savings: Math.abs(w.amount) * 0.2,
      timeline: "3-6 months",
      difficulty: "medium",
      rationale: `Currently ${fmtPct(w.percentOfRevenue)} of revenue — above ${BENCHMARKS.opexLineWarn}% threshold. 20% cut achievable through vendor renegotiation and process tightening.`,
    });
  }

  // 2) Tighten DSO by 15 days
  const dsoRow = benchmarks.find((b) => b.metric.startsWith("DSO"));
  if (dsoRow && pl.revenue && dsoRow.actualNumeric > BENCHMARKS.dsoGood) {
    const days = Math.min(15, dsoRow.actualNumeric - BENCHMARKS.dsoGood);
    items.push({
      action: `Reduce DSO by ${days.toFixed(0)} days (collections discipline)`,
      savings: (days / 365) * pl.revenue,
      timeline: "0-3 months",
      difficulty: "easy",
      rationale: "Stricter credit terms, early-payment discounts, dedicated collections owner. Releases working capital.",
    });
  }

  // 3) Extend DPO if too low
  const dpoRow = benchmarks.find((b) => b.metric.startsWith("DPO"));
  if (dpoRow && bs && pl.cogs && dpoRow.actualNumeric < BENCHMARKS.dpoGood) {
    const days = BENCHMARKS.dpoGood - dpoRow.actualNumeric;
    items.push({
      action: `Extend supplier terms by ${days.toFixed(0)} days`,
      savings: (days / 365) * pl.cogs,
      timeline: "3-6 months",
      difficulty: "medium",
      rationale: "Negotiate net-45 or net-60 with top vendors. Standard terms in most B2B industries.",
    });
  }

  // 4) Gross margin lift
  if (pl.grossMargin < BENCHMARKS.grossMarginGood) {
    const ppLift = Math.min(3, BENCHMARKS.grossMarginGood - pl.grossMargin);
    items.push({
      action: `Lift gross margin by ${ppLift.toFixed(0)}pp via pricing + sourcing`,
      savings: (ppLift / 100) * pl.revenue,
      timeline: "6-12 months",
      difficulty: "hard",
      rationale: "Combination of selective price increases on premium SKUs and consolidation of top-3 raw material vendors for volume discount.",
    });
  }

  return items.sort((a, b) => b.savings - a.savings);
}

function buildAISummary(
  pl: PLResult,
  pla: PLResult,
  monthsActual: number,
  issues: CriticalIssue[],
  opportunities: GrowthOpportunity[]
): string {
  const lines: string[] = [];
  // Para 1: top-line
  lines.push(
    `The company posted revenue of ${fmtCr(pl.revenue)} over ${monthsActual} months of actual data (annualized: ${fmtCr(pla.revenue)}). ` +
    `Gross margin came in at ${fmtPct(pl.grossMargin)} and EBITDA at ${fmtPct(pl.ebitdaMargin)}, producing ${pl.pat >= 0 ? "a net profit" : "a net loss"} of ${fmtCr(Math.abs(pl.pat))} for the period.`
  );
  // Para 2: issues
  if (issues.length > 0) {
    const topIssue = issues[0]!;
    lines.push(
      `The most pressing issue is ${topIssue.title.toLowerCase()}. ${topIssue.rootCause} ` +
      `Addressing the top ${Math.min(issues.length, 3)} issues identified below could meaningfully improve the bottom line.`
    );
  } else {
    lines.push("The financial profile is broadly healthy across margins, working capital and concentration metrics.");
  }
  // Para 3: opportunities
  if (opportunities.length > 0) {
    lines.push(
      `On the upside, ${opportunities.length} growth opportunities have been identified — ranging from customer-profile replication to geographic and product-mix expansion. ` +
      `Execution discipline on the top opportunity (${opportunities[0]!.title.toLowerCase()}) is likely the highest-ROI bet for the next 12 months.`
    );
  }
  return lines.join("\n\n");
}

export function analyze(files: ParsedFiles, targetFY = "FY24-25"): AnalysisResult {
  // Normalize to arrays (single-buffer legacy callers still work)
  const glBufs = files.glBuffers ?? (files.glBuffer ? [files.glBuffer] : []);
  const salesBufs = files.salesBuffers ?? (files.salesBuffer ? [files.salesBuffer] : []);
  const purBufs = files.purchaseBuffers ?? (files.purchaseBuffer ? [files.purchaseBuffer] : []);
  const invBufs = files.inventoryBuffers ?? (files.inventoryBuffer ? [files.inventoryBuffer] : []);
  const budBufs = files.budgetBuffers ?? [];
  const custAgingBufs = files.customerAgingBuffers ?? [];
  const vendAgingBufs = files.vendorAgingBuffers ?? [];
  const result: AnalysisResult = {
    period: targetFY,
    monthsActual: 0,
    plActual: emptyPL(),
    plAnnualized: emptyPL(),
    monthlyRevenue: [],
    topCustomers: [],
    topVendors: [],
    countryRevenue: [],
    currencyRevenue: [],
    totalAR: 0,
    totalAP: 0,
    glAccountCount: 0,
    itemCategories: [],
    variance: [],
    hasBudget: false,
    customerAging: null,
    vendorAging: null,
    cashFlow: null,
    insights: [],
    criticalIssues: [],
    growthOpportunities: [],
    balanceSheet: null,
    costStructure: [],
    benchmarks: [],
    improvements: [],
    aiSummary: "",
  };
  let latestGLPostingDate: Date | null = null;
  let fyAcctTotalsRef: Map<string, Map<string, number>> = new Map();

  // ---- GL Entry: foundation ----
  if (glBufs.length > 0) {
    // Try common sheet names, then fall back to active sheet
    let rows = readSheets(glBufs, "GL Entry", 3);
    if (rows.length === 0) rows = readSheets(glBufs, undefined, 3);
    if (rows.length === 0) rows = readSheets(glBufs, undefined, 1);

    const fyCatTotals = new Map<string, Map<string, number>>();
    const fyAcctTotals = new Map<string, Map<string, number>>();
    const monthlyRevenue = new Map<string, number>();
    const accounts = new Set<string>();
    for (const r of rows) {
      const d = parseDate(r["Posting Date"]);
      if (!d) continue;
      if (!latestGLPostingDate || d > latestGLPostingDate) latestGLPostingDate = d;
      const acct = String(r["G/L Account No."] ?? "");
      if (!acct) continue;
      accounts.add(acct);
      const amt = Number(r["Amount"] ?? 0) || 0;
      const cat = classifyAccount(acct);
      const fy = fyOf(d);

      let catMap = fyCatTotals.get(fy);
      if (!catMap) { catMap = new Map(); fyCatTotals.set(fy, catMap); }
      catMap.set(cat, (catMap.get(cat) || 0) + amt);

      let acctMap = fyAcctTotals.get(fy);
      if (!acctMap) { acctMap = new Map(); fyAcctTotals.set(fy, acctMap); }
      acctMap.set(acct, (acctMap.get(acct) || 0) + amt);

      if (cat === "Revenue") {
        const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        monthlyRevenue.set(ym, (monthlyRevenue.get(ym) || 0) + amt);
      }
    }

    result.glAccountCount = accounts.size;
    const cats = fyCatTotals.get(targetFY) || new Map();
    result.plActual = buildPL(cats);

    // Monthly revenue for target FY (clip Apr-Mar)
    const monthsInFY: Array<{ month: string; revenue: number }> = [];
    let activeMonths = 0;
    for (const [ym, rev] of monthlyRevenue.entries()) {
      const [y, m] = ym.split("-").map(Number);
      const d = new Date(y, m - 1, 1);
      if (fyOf(d) === targetFY) {
        monthsInFY.push({ month: ym, revenue: -rev });
        if (Math.abs(rev) > 1000) activeMonths++;
      }
    }
    monthsInFY.sort((a, b) => a.month.localeCompare(b.month));
    result.monthlyRevenue = monthsInFY;
    result.monthsActual = Math.max(activeMonths, 1);

    const factor = 12 / result.monthsActual;
    const ann = { ...result.plActual };
    (Object.keys(ann) as Array<keyof PLResult>).forEach((k) => {
      if (!String(k).toLowerCase().includes("margin")) {
        (ann[k] as number) = (ann[k] as number) * factor;
      }
    });
    // Re-derive margins on annualized base
    const r = ann.revenue || 1;
    ann.grossMargin = (ann.grossProfit / r) * 100;
    ann.ebitdaMargin = (ann.ebitda / r) * 100;
    ann.ebitMargin = (ann.ebit / r) * 100;
    ann.pbtMargin = (ann.pbt / r) * 100;
    ann.patMargin = (ann.pat / r) * 100;
    result.plAnnualized = ann;

    // AR / AP from GL balances
    let ar = 0, ap = 0;
    for (const acctMap of fyAcctTotals.values()) {
      for (const a of ["2310", "2320", "2330"]) ar += acctMap.get(a) || 0;
      for (const a of ["5410", "5420"]) ap += acctMap.get(a) || 0;
    }
    result.totalAR = ar;
    result.totalAP = -ap;
    fyAcctTotalsRef = fyAcctTotals;
  }

  // ---- Sales: top customers, geo, currency ----
  if (salesBufs.length > 0) {
    let hdrRows = readSheets(salesBufs, "Sales Invoice Header", 3);
    let lnRows = readSheets(salesBufs, "Sales Invoice Line", 3);
    // If file has only one sheet, treat it as a flat sales register
    if (hdrRows.length === 0 && lnRows.length === 0) {
      const flat = readSheets(salesBufs, undefined, 3);
      hdrRows = flat;
      lnRows = flat;
    }
    const hdrByDoc = new Map<string, Record<string, any>>();
    for (const h of hdrRows) {
      const no = String(h["No."] ?? "");
      if (no) hdrByDoc.set(no, h);
    }
    const docAmt = new Map<string, number>();
    for (const ln of lnRows) {
      const doc = String(ln["Document No."] ?? "");
      const amt = Number(ln["Line Amount"] ?? 0) || 0;
      docAmt.set(doc, (docAmt.get(doc) || 0) + amt);
    }
    const custMap = new Map<string, number>();
    const ctryMap = new Map<string, number>();
    const currMap = new Map<string, number>();
    for (const [doc, amt] of docAmt.entries()) {
      const h = hdrByDoc.get(doc) || {};
      const name = String(h["Bill-to Name"] ?? h["Sell-to Customer Name"] ?? "Unknown");
      custMap.set(name, (custMap.get(name) || 0) + amt);
      const ctry = String(h["Ship-to Country/Region Code"] ?? h["Sell-to Country/Region Code"] ?? "IN");
      ctryMap.set(ctry, (ctryMap.get(ctry) || 0) + amt);
      const cur = String(h["Currency Code"] ?? "INR (Local)");
      currMap.set(cur || "INR (Local)", (currMap.get(cur || "INR (Local)") || 0) + amt);
    }
    result.topCustomers = [...custMap.entries()]
      .map(([name, amount]) => ({ name, amount }))
      .sort((a, b) => b.amount - a.amount).slice(0, 10);
    result.countryRevenue = [...ctryMap.entries()]
      .map(([country, amount]) => ({ country, amount }))
      .sort((a, b) => b.amount - a.amount);
    result.currencyRevenue = [...currMap.entries()]
      .map(([currency, amount]) => ({ currency, amount }))
      .sort((a, b) => b.amount - a.amount);
  }

  // ---- Purchase: top vendors ----
  if (purBufs.length > 0) {
    let hdrRows = readSheets(purBufs, "Purch. Inv. Header", 3);
    let lnRows = readSheets(purBufs, "Purch. Inv. Line", 3);
    if (hdrRows.length === 0 && lnRows.length === 0) {
      const flat = readSheets(purBufs, undefined, 3);
      hdrRows = flat;
      lnRows = flat;
    }
    const hdrByDoc = new Map<string, Record<string, any>>();
    for (const h of hdrRows) {
      const no = String(h["No."] ?? "");
      if (no) hdrByDoc.set(no, h);
    }
    const vendMap = new Map<string, number>();
    for (const ln of lnRows) {
      const doc = String(ln["Document No."] ?? "");
      const amt = Number(ln["Line Amount"] ?? 0) || 0;
      const h = hdrByDoc.get(doc) || {};
      const name = String(
        h["Pay-to Name"] ?? h["Buy-from Vendor Name"] ?? h["Buy-from Vendor No."] ?? "Unknown"
      );
      vendMap.set(name, (vendMap.get(name) || 0) + amt);
    }
    result.topVendors = [...vendMap.entries()]
      .map(([name, amount]) => ({ name, amount }))
      .sort((a, b) => b.amount - a.amount).slice(0, 10);
  }

  // ---- Inventory: item categories ----
  if (invBufs.length > 0) {
    let itemRows = readSheets(invBufs, "Item Ledger Entry", 3);
    if (itemRows.length === 0) itemRows = readSheets(invBufs, undefined, 3);
    const catMap = new Map<string, number>();
    for (const r of itemRows) {
      if (r["Entry Type"] !== "Sale") continue;
      const cat = String(r["Item Category Code"] ?? "UNCAT");
      catMap.set(cat, (catMap.get(cat) || 0) + Math.abs(Number(r["Quantity"] ?? 0)));
    }
    result.itemCategories = [...catMap.entries()]
      .map(([category, quantity]) => ({ category, quantity }))
      .sort((a, b) => b.quantity - a.quantity);
  }

  // ---- Budget vs Actual variance ----
  if (budBufs.length > 0) {
    // Variance is computed against actuals (not annualized) by default.
    // Most budgets are full-year; users can compare against the annualized P&L instead by uploading FY budgets.
    result.variance = parseBudget(budBufs, result.plAnnualized);
    result.hasBudget = result.variance.length > 0;
  }

  // ---- Customer / Vendor Aging + Cash Flow Projection ----
  const asOf = latestGLPostingDate ?? new Date();
  if (custAgingBufs.length > 0) {
    result.customerAging = parseAging(custAgingBufs, asOf);
  }
  if (vendAgingBufs.length > 0) {
    result.vendorAging = parseAging(vendAgingBufs, asOf);
  }
  if (result.customerAging || result.vendorAging) {
    result.cashFlow = buildCashFlow(result.customerAging, result.vendorAging);
  }

  // ---- Analytical layer ----
  if (fyAcctTotalsRef.size > 0) {
    result.balanceSheet = computeBalanceSheet(fyAcctTotalsRef);
    result.costStructure = computeCostStructure(fyAcctTotalsRef, targetFY, result.plActual.revenue);
  }
  result.benchmarks = computeBenchmarks(
    result.plActual,
    result.balanceSheet,
    result.customerAging,
    result.vendorAging,
    result.plAnnualized.cogs
  );
  result.criticalIssues = detectCriticalIssues(
    result.plActual,
    result.benchmarks,
    result.topCustomers,
    result.topVendors,
    result.balanceSheet
  );
  result.growthOpportunities = suggestGrowthOpportunities(
    result.plActual,
    result.topCustomers,
    result.countryRevenue,
    result.itemCategories,
    result.monthlyRevenue
  );
  result.insights = generateInsights(
    result.plActual,
    result.plAnnualized,
    result.monthlyRevenue,
    result.totalAR,
    result.totalAP,
    result.topCustomers
  );
  result.improvements = buildImprovements(
    result.plActual,
    result.balanceSheet,
    result.costStructure,
    result.benchmarks
  );
  result.aiSummary = buildAISummary(
    result.plActual,
    result.plAnnualized,
    result.monthsActual,
    result.criticalIssues,
    result.growthOpportunities
  );

  return result;
}
