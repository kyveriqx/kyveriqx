/* Digital (text-based) PDF → row/cell matrix.

   Bank statements are often only available as PDF. We turn a text PDF into
   the SAME matrix shape parse.ts already builds from XLSX/CSV, so the column
   detection + matcher downstream are unchanged. No OCR — a scanned PDF (no
   selectable text) is detected and rejected with a clear message.

   Reconstruction (itemsToMatrix) is a pure function so it can be unit-tested
   with synthetic text items; the pdf.js extraction (pdfToMatrix) is a thin
   async wrapper around `unpdf` (lazy-imported so the XLSX/CSV path stays
   light). Columns are found with a projection-profile: vertical whitespace
   "gutters" that most rows leave blank are the separators — robust to
   free-text narration where word x-positions vary line to line. */

export type TextItem = { str: string; x: number; y: number; w: number; page?: number };

const Y_TOL = 3.5;          // pts — items within this y are on the same visual line
const BIN = 2;              // pts — x histogram resolution
const MIN_GUTTER_PTS = 6;   // pts — a separator gutter must be at least this wide
const GUTTER_RATIO = 0.12;  // a bin is "gutter" if < this fraction of rows cover it

const HEADER_HINTS = [
  "date", "particular", "narration", "description", "details", "remark",
  "withdrawal", "deposit", "debit", "credit", "amount", "balance",
  "chq", "cheque", "ref", "value", "txn", "dr", "cr",
];

// ── row grouping ─────────────────────────────────────────────────────────

function groupRows(items: TextItem[]): TextItem[][] {
  const sorted = [...items].sort(
    (a, b) => (a.page ?? 0) - (b.page ?? 0) || b.y - a.y || a.x - b.x, // pdf y is bottom-up
  );
  const rows: TextItem[][] = [];
  let cur: TextItem[] = [];
  let curY = 0, curPage = 0;
  for (const it of sorted) {
    if (cur.length === 0) { cur = [it]; curY = it.y; curPage = it.page ?? 0; continue; }
    if ((it.page ?? 0) === curPage && Math.abs(it.y - curY) <= Y_TOL) {
      cur.push(it);
    } else {
      rows.push(cur); cur = [it]; curY = it.y; curPage = it.page ?? 0;
    }
  }
  if (cur.length) rows.push(cur);
  for (const r of rows) r.sort((a, b) => a.x - b.x);
  return rows;
}

// ── column detection (projection profile) ───────────────────────────────

function detectColumns(rows: TextItem[][]): Array<[number, number]> {
  const all = rows.flat();
  if (!all.length) return [[0, 1]];
  const minX = Math.min(...all.map((i) => i.x));
  const maxX = Math.max(...all.map((i) => i.x + i.w));
  const nbins = Math.max(1, Math.ceil((maxX - minX) / BIN) + 1);

  // how many ROWS put any text in each x-bin
  const cover = new Array<number>(nbins).fill(0);
  for (const row of rows) {
    const hit = new Set<number>();
    for (const it of row) {
      const b0 = Math.max(0, Math.floor((it.x - minX) / BIN));
      const b1 = Math.min(nbins - 1, Math.floor((it.x + it.w - minX) / BIN));
      for (let b = b0; b <= b1; b++) hit.add(b);
    }
    for (const b of hit) cover[b]++;
  }

  const gutterThresh = Math.max(1, rows.length * GUTTER_RATIO);
  const minGutterBins = Math.max(1, Math.round(MIN_GUTTER_PTS / BIN));

  // wide runs of low-coverage bins are column separators
  const gutters: Array<[number, number]> = [];
  let g0 = -1;
  for (let b = 0; b < nbins; b++) {
    const isGut = cover[b] < gutterThresh;
    if (isGut && g0 < 0) g0 = b;
    if (!isGut && g0 >= 0) { if (b - g0 >= minGutterBins) gutters.push([g0, b]); g0 = -1; }
  }
  if (g0 >= 0 && nbins - g0 >= minGutterBins) gutters.push([g0, nbins]);

  // columns = the spans between the gutters
  const cols: Array<[number, number]> = [];
  let pos = 0;
  for (const [a, b] of gutters) {
    if (a > pos) cols.push([minX + pos * BIN, minX + a * BIN]);
    pos = b;
  }
  if (pos < nbins) cols.push([minX + pos * BIN, maxX + BIN]);
  return cols.length ? cols : [[minX, maxX + BIN]];
}

function colIndexFor(center: number, cols: Array<[number, number]>): number {
  for (let i = 0; i < cols.length; i++) if (center >= cols[i][0] && center < cols[i][1]) return i;
  // nearest column when an item sits inside a gutter
  let best = 0, bestD = Infinity;
  for (let i = 0; i < cols.length; i++) {
    const mid = (cols[i][0] + cols[i][1]) / 2;
    const d = Math.abs(center - mid);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

// ── narration-wrap merge + header trim ───────────────────────────────────

const numberish = (s: string) => /\d/.test(s) && /^[\d.,()₹$\s+-]+(cr|dr)?$/i.test(s.trim());
const dateish = (s: string) =>
  /\d{1,4}[/\-.]\d{1,2}[/\-.]\d{2,4}/.test(s) || /\b\d{1,2}[\s-][A-Za-z]{3}/.test(s);

function headerScore(cells: string[]): number {
  const joined = cells.join(" ").toLowerCase();
  return HEADER_HINTS.reduce((n, h) => n + (joined.includes(h) ? 1 : 0), 0);
}

/** Reconstruct a rectangular matrix from positioned text items. Pure. */
export function itemsToMatrix(items: TextItem[]): string[][] {
  const clean = items.filter((i) => i.str.trim() !== "");
  if (!clean.length) return [];

  const rows = groupRows(clean);
  const cols = detectColumns(rows);

  let matrix = rows.map((row) => {
    const cells = new Array<string>(cols.length).fill("");
    for (const it of row) {
      const ci = colIndexFor(it.x + it.w / 2, cols);
      const t = it.str.trim();
      cells[ci] = cells[ci] ? `${cells[ci]} ${t}` : t;
    }
    return cells;
  });

  // Trim the address/summary preamble: start at the column-header row so the
  // downstream probeHeaders (which only scans the first few rows) finds it.
  let headerRow = -1, headerBest = 1;
  for (let r = 0; r < matrix.length; r++) {
    const s = headerScore(matrix[r]);
    if (s > headerBest) { headerBest = s; headerRow = r; }
  }
  if (headerRow > 0) matrix = matrix.slice(headerRow);

  // Fold wrapped narration: a row with exactly one non-empty, non-numeric,
  // non-date cell is a continuation of the previous transaction's description.
  const merged: string[][] = [];
  for (const cells of matrix) {
    const filled = cells.map((c, i) => [c, i] as const).filter(([c]) => c.trim() !== "");
    let isCont = false;
    if (merged.length > 0 && filled.length === 1) {
      const [val, ci] = filled[0];
      const prevCell = merged[merged.length - 1][ci];
      // Only fold a single text cell into the previous row when it lands on a
      // descriptive (non-numeric, non-date) column — never onto an amount/date,
      // so stray footers ("Page 1 of 1") can't corrupt a transaction.
      isCont = !numberish(val) && !dateish(val) &&
        (prevCell === "" || (!numberish(prevCell) && !dateish(prevCell)));
    }
    if (isCont) {
      const [val, ci] = filled[0];
      const prev = merged[merged.length - 1];
      prev[ci] = prev[ci] ? `${prev[ci]} ${val.trim()}` : val.trim();
    } else {
      merged.push(cells);
    }
  }
  return merged;
}

/** A digital PDF yields enough text items; a scanned one yields ~none. */
export function hasSelectableText(items: TextItem[]): boolean {
  const totalChars = items.reduce((n, i) => n + i.str.length, 0);
  return items.length >= 5 && totalChars >= 20;
}

// ── pdf.js extraction (lazy `unpdf`) ─────────────────────────────────────

/** Extract a matrix from a digital PDF. Throws a friendly error if the PDF
 *  has no selectable text (i.e. it's scanned). */
export async function pdfToMatrix(buffer: Buffer): Promise<unknown[][]> {
  const { getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buffer));

  const items: TextItem[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    for (const raw of content.items as Array<{ str?: string; transform?: number[]; width?: number }>) {
      const str = (raw.str ?? "").trim();
      if (!str || !raw.transform) continue;
      items.push({ str, x: raw.transform[4], y: raw.transform[5], w: raw.width ?? 0, page: p });
    }
  }

  if (!hasSelectableText(items)) {
    throw new Error(
      "This PDF has no selectable text (it looks scanned). Please upload the Excel/CSV export or a text-based PDF.",
    );
  }
  return itemsToMatrix(items);
}
