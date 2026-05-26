"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Branding = {
  companyName: string;
  tagline: string;
  vision: string;
  logoDataUrl: string | null;
  primaryColor: string;
  accentColor: string;
  reportingPeriod: string;
  preparedFor: string;
};

export type UploadedFile = {
  id: string;
  filename: string;
  size: number;
  blobUrl?: string;
  uploadedAt: string;
};

export type FileSection =
  | "glOrTrialBalance"
  | "sales"
  | "purchase"
  | "inventory"
  | "budget"
  | "customerAging"
  | "vendorAging";

export type FileMap = Partial<Record<FileSection, UploadedFile[]>>;

export type OutlookPillar = { tag: string; title: string; bullets: string[] };

export type Achievement = { title: string; body: string };

export type Outlook = {
  growth: OutlookPillar;
  profitability: OutlookPillar;
  capability: OutlookPillar;
  risks: string[];
  asks: string[];
  achievements: Achievement[]; // exactly 4 for the Key Achievements slide
};

const DEFAULT_BRANDING: Branding = {
  companyName: "Your Company Name",
  tagline: "Your Tagline / Vision Statement",
  vision: "",
  logoDataUrl: null,
  primaryColor: "#1F3864",
  accentColor: "#BF8F00",
  reportingPeriod: "FY 2024-25",
  preparedFor: "Board of Directors",
};

const DEFAULT_OUTLOOK: Outlook = {
  growth: {
    tag: "GROWTH",
    title: "Revenue & Market Expansion",
    bullets: [
      "Insert revenue target for next fiscal year",
      "Insert new market / geography plans",
      "Insert new product launches",
      "Insert channel expansion — e-commerce / B2B",
    ],
  },
  profitability: {
    tag: "PROFITABILITY",
    title: "Margin & Cost Discipline",
    bullets: [
      "Insert EBITDA margin target",
      "Insert opex optimization initiatives",
      "Insert raw material / sourcing strategy",
      "Insert pricing actions",
    ],
  },
  capability: {
    tag: "CAPABILITY",
    title: "People, Tech & Infrastructure",
    bullets: [
      "Insert hiring / talent plan",
      "Insert capex / tech investment",
      "Insert digital / automation roadmap",
      "Insert compliance / governance upgrades",
    ],
  },
  risks: [
    "Margin pressure — EBITDA buffer is limited for cost shocks",
    "Customer concentration — top customers carry significant revenue share",
    "FX exposure on multi-currency receivables",
    "Working capital risk if collection cycles extend",
  ],
  asks: [
    "Approval for next-year budget & capex plan",
    "Guidance on customer concentration mitigation",
    "Sign-off on financing / working capital strategy",
    "Direction on expansion priorities",
  ],
  achievements: [
    {
      title: "Revenue Scale-Up",
      body: "Annualized revenue grew steadily through the year — clear demand acceleration in the second half.",
    },
    {
      title: "Margin Strength",
      body: "Gross margin held above 35% — disciplined pricing and sourcing of raw materials.",
    },
    {
      title: "Global Diversification",
      body: "Revenue from 10+ countries across multiple currencies — de-risks single-market dependency.",
    },
    {
      title: "Compliance & Digital",
      body: "Full e-invoicing live (IRN/QR), GST compliance across multiple states, automation roadmap underway.",
    },
  ],
};

interface AppState {
  branding: Branding;
  files: FileMap;
  outlook: Outlook;
  lastRunId: string | null;
  setBranding: (b: Partial<Branding>) => void;
  addFile: (section: FileSection, file: UploadedFile) => void;
  removeFile: (section: FileSection, fileId: string) => void;
  clearSection: (section: FileSection) => void;
  setOutlook: (o: Partial<Outlook>) => void;
  setLastRunId: (id: string | null) => void;
  resetAll: () => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      branding: DEFAULT_BRANDING,
      files: {},
      outlook: DEFAULT_OUTLOOK,
      lastRunId: null,
      setBranding: (b) => set((s) => ({ branding: { ...s.branding, ...b } })),
      addFile: (section, file) =>
        set((s) => {
          // Defensively normalize: legacy shape stored a single object here
          const raw = s.files[section] as any;
          const existing: UploadedFile[] = Array.isArray(raw)
            ? raw
            : raw && typeof raw === "object" && raw.id
            ? [raw]
            : [];
          return { files: { ...s.files, [section]: [...existing, file] } };
        }),
      removeFile: (section, fileId) =>
        set((s) => {
          const raw = s.files[section] as any;
          const existing: UploadedFile[] = Array.isArray(raw)
            ? raw
            : raw && typeof raw === "object" && raw.id
            ? [raw]
            : [];
          const filtered = existing.filter((f) => f.id !== fileId);
          const next = { ...s.files };
          if (filtered.length) next[section] = filtered;
          else delete next[section];
          return { files: next };
        }),
      clearSection: (section) =>
        set((s) => {
          const next = { ...s.files };
          delete next[section];
          return { files: next };
        }),
      setOutlook: (o) => set((s) => ({ outlook: { ...s.outlook, ...o } })),
      setLastRunId: (id) => set({ lastRunId: id }),
      resetAll: () =>
        set({
          branding: DEFAULT_BRANDING,
          files: {},
          outlook: DEFAULT_OUTLOOK,
          lastRunId: null,
        }),
    }),
    {
      name: "bod-mis-store",
      version: 3,
      migrate: (persisted: any, fromVersion: number) => {
        // v1 -> v2: files[section] changed from UploadedFile to UploadedFile[]
        if (fromVersion < 2 && persisted?.files) {
          const nextFiles: any = {};
          for (const [k, v] of Object.entries(persisted.files)) {
            if (Array.isArray(v)) nextFiles[k] = v;
            else if (v && typeof v === "object" && (v as any).id) nextFiles[k] = [v];
          }
          persisted.files = nextFiles;
        }
        // v2 -> v3: outlook.achievements added
        if (fromVersion < 3 && persisted?.outlook && !persisted.outlook.achievements) {
          persisted.outlook.achievements = DEFAULT_OUTLOOK.achievements;
        }
        return persisted;
      },
    }
  )
);

export const FILE_SECTIONS: Array<{
  key: FileSection;
  title: string;
  description: string;
  examples: string;
  required: boolean;
}> = [
  {
    key: "glOrTrialBalance",
    title: "GL / Trial Balance",
    description:
      "The financial backbone — used to compute P&L, EBITDA, margins, and balance-sheet snapshots.",
    examples:
      "Any GL Entry export or Trial Balance from your accounting / ERP system (Excel).",
    required: true,
  },
  {
    key: "sales",
    title: "Sales Data",
    description:
      "Sales invoice register. Drives Top Customers, geography, and currency analysis.",
    examples:
      "Sales register, invoice export, or customer-wise sales report from your ERP (Excel).",
    required: false,
  },
  {
    key: "purchase",
    title: "Purchase Data",
    description:
      "Purchase invoice register. Drives Top Vendors and procurement spend analysis.",
    examples:
      "Purchase register, vendor invoice export, or AP report from your ERP (Excel).",
    required: false,
  },
  {
    key: "inventory",
    title: "Inventory / Stock Ledger",
    description:
      "Item movements and stock data — drives category mix and SKU velocity views.",
    examples:
      "Item ledger, stock register, or inventory movement report (Excel).",
    required: false,
  },
  {
    key: "budget",
    title: "Budget (Income / Expense)",
    description:
      "Optional. Drives variance analysis (Actual vs Budget) across revenue and expense lines.",
    examples:
      "Income budget, expense budget, or combined budget. Two columns: line item + budget amount.",
    required: false,
  },
  {
    key: "customerAging",
    title: "Customer Aging (Receivables)",
    description:
      "Open invoices by customer, aged into buckets. Drives DSO, top overdue customers, and expected collections.",
    examples:
      "Aged receivables report — either with bucket columns (0-30 / 31-60 / 61-90 …) OR invoice-level with dates (Customer, Invoice Date, Due Date, Amount).",
    required: false,
  },
  {
    key: "vendorAging",
    title: "Vendor Aging (Payables)",
    description:
      "Open bills by vendor, aged into buckets. Drives DPO, payments due, and cash-out planning.",
    examples:
      "Aged payables report — either with bucket columns OR invoice-level with dates (Vendor, Bill Date, Due Date, Amount).",
    required: false,
  },
];
