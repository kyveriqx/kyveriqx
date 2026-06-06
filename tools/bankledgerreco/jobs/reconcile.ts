/* Bank ledger reconciliation — Architecture §8.5.
   Downloads the uploaded bank statement(s) + books ledger(s) (+ optional
   Razorpay settlement report(s)), merges each side into one dataset, runs the
   multi-pass matcher, and writes the BankReconcileResult back to the jobs row
   via runJob. Each side may receive several files (e.g. monthly statements);
   they are parsed independently and concatenated, with each row keeping its
   source filename. */

import { logger, task } from "@trigger.dev/sdk";
import { runJob } from "../../../core/lib/job-runner";
import { downloadSupabaseUploadNamed } from "../../../core/lib/supabase-uploads";
import { STORAGE_BUCKETS } from "../../../core/lib/storage-buckets";
import { parseBankStatement, parseBooksLedger, mergeTxns, checkRunningBalance } from "../lib/parse";
import { parseSettlementReport } from "../lib/settlement";
import { reconcile } from "../lib/match";
import { DEFAULT_OPTIONS } from "../lib/types";
import type { ReconcileOptions, SettlementRow, FileSource } from "../lib/types";

type Payload = {
  jobId: string;
  userId: string;
  toolId: string;
  bankUploadIds: string[];
  booksUploadIds: string[];
  settlementUploadIds?: string[];
  options?: Partial<ReconcileOptions>;
};

const BUCKET = STORAGE_BUCKETS.ledgerUploads;

async function fetchNamed(uploadId: string, label: string): Promise<{ filename: string; buffer: Buffer }> {
  const got = await downloadSupabaseUploadNamed(`supabase:${uploadId}`, BUCKET);
  if (!got) throw new Error(`could not download ${label} (upload ${uploadId})`);
  return got;
}

/** Warn when later files map a key column differently from the first file. */
function columnNotes(
  label: string,
  filenames: string[],
  columns: Array<Record<string, string | null>>,
): string[] {
  if (columns.length < 2) return [];
  const base = columns[0];
  const keys = ["date", "debit", "credit", "amount"];
  const out: string[] = [];
  for (let i = 1; i < columns.length; i++) {
    const diff = keys.filter((k) => (columns[i][k] ?? null) !== (base[k] ?? null));
    if (diff.length) {
      out.push(
        `${filenames[i]} ${label} column mapping differs from ${filenames[0]} (${diff.join(", ")}) — parsed independently.`,
      );
    }
  }
  return out;
}

type ParsedFile<T> = { filename: string; txns: T[]; columns: Record<string, string | null> };

/** Parse every file on one side, isolating per-file failures.
 *
 *  A single unreadable file must NOT sink the whole job: a PDF the parser
 *  chokes on, a corrupt export, or — the common one — the *other* side's
 *  ledger accidentally dropped into this dropzone. Each such file is skipped
 *  with a named, dropzone-aware note and the run continues on the files that
 *  did parse. A file that reads but yields no usable rows is treated the same
 *  (it's almost always the wrong file in the slot). We abort the side only
 *  when NOTHING on it parsed — then the original format guidance is surfaced. */
async function parseSide<T>(
  files: Array<{ filename: string; buffer: Buffer }>,
  parse: (buf: Buffer) => Promise<{ txns: T[]; columns: Record<string, string | null>; headers: string[] }>,
  label: string,
  otherLabel: string,
): Promise<{ ok: ParsedFile<T>[]; notes: string[] }> {
  const ok: ParsedFile<T>[] = [];
  const notes: string[] = [];
  for (const f of files) {
    try {
      const parsed = await parse(f.buffer);
      if (parsed.txns.length === 0) {
        notes.push(
          `Skipped “${f.filename}” — no readable rows for a ${label} ` +
          `(couldn't find Date and Debit/Credit/Amount columns). ` +
          `If this is your ${otherLabel}, upload it on the ${otherLabel} side instead.`,
        );
        continue;
      }
      ok.push({ filename: f.filename, txns: parsed.txns, columns: parsed.columns });
    } catch (err) {
      void err;
      notes.push(
        `Skipped “${f.filename}” — it couldn't be read as a ${label}. ` +
        `If this is your ${otherLabel}, upload it on the ${otherLabel} side instead.`,
      );
    }
  }
  if (ok.length === 0) {
    throw new Error(
      `Could not read any ${label} — please check the file format. ` +
      `Each file needs a header row with Date and Debit/Credit (or Amount) columns.`,
    );
  }
  return { ok, notes };
}

export const bankReconcile = task({
  id: "bank-ledger-reconcile",
  maxDuration: 1800,
  run: (payload: Payload) =>
    runJob(payload, async (p) => {
      const opts: ReconcileOptions = { ...DEFAULT_OPTIONS, ...(p.options ?? {}) };
      logger.info("starting bank reconciliation", {
        jobId: p.jobId,
        bankFiles: p.bankUploadIds.length,
        booksFiles: p.booksUploadIds.length,
        settlementFiles: p.settlementUploadIds?.length ?? 0,
        opts,
      });

      // ── Download every file on each side ────────────────────────────────
      const [bankFiles, booksFiles] = await Promise.all([
        Promise.all(p.bankUploadIds.map((id) => fetchNamed(id, "bank statement"))),
        Promise.all(p.booksUploadIds.map((id) => fetchNamed(id, "books ledger"))),
      ]);

      // ── Parse each file independently, isolating per-file failures, then
      //    merge into one dataset per side. One unreadable file is skipped with
      //    a named note (see parseSide) rather than failing the whole run. ─────
      const [bank, books] = await Promise.all([
        parseSide(bankFiles, parseBankStatement, "bank statement", "books ledger"),
        parseSide(booksFiles, parseBooksLedger, "books ledger", "bank statement"),
      ]);

      const bankMerge = mergeTxns(
        bank.ok.map((x) => ({ file: x.filename, txns: x.txns })),
        (t) => t.date,
      );
      const booksMerge = mergeTxns(
        books.ok.map((x) => ({ file: x.filename, txns: x.txns })),
        (t) => t.date,
      );

      // ── Optional Razorpay settlement report(s) ──────────────────────────
      // Optional input — an unreadable settlement export must not fail the core
      // reconciliation, so each file is parsed defensively and the run proceeds
      // without it (with a note) if none parse.
      let settlementMerge: { merged: SettlementRow[]; sources: FileSource[]; notes: string[] } | null = null;
      const settlementSkipNotes: string[] = [];
      const settlementIds = p.settlementUploadIds ?? [];
      if (settlementIds.length) {
        const sFiles = await Promise.all(settlementIds.map((id) => fetchNamed(id, "settlement report")));
        const sParts: Array<{ file: string; txns: SettlementRow[] }> = [];
        for (const f of sFiles) {
          try {
            sParts.push({ file: f.filename, txns: parseSettlementReport(f.buffer).rows });
          } catch (err) {
            void err;
            settlementSkipNotes.push(
              `Skipped settlement report “${f.filename}” — it couldn't be read as a Razorpay settlement export. The reconciliation ran without it.`,
            );
          }
        }
        if (sParts.length) settlementMerge = mergeTxns(sParts, (s) => s.settledAt);
      }

      const result = reconcile(
        bankMerge.merged,
        booksMerge.merged,
        opts,
        settlementMerge?.merged ?? [],
        { bankColumns: bank.ok[0].columns, booksColumns: books.ok[0].columns },
      );

      // Per-file running-balance tie-out: catches a row misread/dropped/duplicated
      // during parsing (esp. the PDF path) before the gap is trusted. Run per file
      // — balance continuity only holds within one statement, not across the merge.
      const balanceNotes = [
        ...bank.ok.map((x) => checkRunningBalance(x.txns, x.filename)),
        ...books.ok.map((x) => checkRunningBalance(x.txns, x.filename)),
      ].filter((n): n is string => n !== null);

      const extraNotes = [
        ...bank.notes,
        ...books.notes,
        ...settlementSkipNotes,
        ...balanceNotes,
        ...bankMerge.notes,
        ...booksMerge.notes,
        ...(settlementMerge?.notes ?? []),
        ...columnNotes("bank statement", bank.ok.map((x) => x.filename), bank.ok.map((x) => x.columns)),
        ...columnNotes("books ledger", books.ok.map((x) => x.filename), books.ok.map((x) => x.columns)),
      ];

      logger.info("bank reconciliation done", {
        jobId: p.jobId,
        bankRows: bankMerge.merged.length,
        booksRows: booksMerge.merged.length,
        groups: result.summary.matchedGroups,
        unmatchedBank: result.summary.unmatchedBankCount,
        unmatchedBooks: result.summary.unmatchedBooksCount,
        netGap: result.summary.netGap,
      });

      return {
        ...result,
        notes: [...result.notes, ...extraNotes],
        sources: {
          bank: bankMerge.sources,
          books: booksMerge.sources,
          settlement: settlementMerge?.sources ?? [],
        },
      };
    }),
});
