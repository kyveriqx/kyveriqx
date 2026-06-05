/* Digital (text-based) PDF → ordered text lines.

   The partner's older statements arrive as Tally "Ledger Account" PDFs, which
   are line-oriented (one voucher per visual row, sub-rows for the GL breakup).
   Unlike the bank tool's `pdfToMatrix` (which detects columns), the Tally
   interpreter in parse-partner-pdf.ts works on whole text LINES and decides
   debit/credit from the printed Dr/Cr token — so here we only need to group
   positioned text items back into the lines a human sees.

   No OCR: a scanned PDF (no selectable text) is detected and rejected with the
   same friendly message the bank tool uses. `unpdf` is lazy-imported so the
   XLSX/CSV path stays light. */

type Item = { str: string; x: number; y: number; page: number };

const Y_TOL = 3.0; // pts — items within this y are on the same visual line

/** Extract the PDF's visible text as an ordered array of lines. Throws a
 *  friendly error when the PDF has no selectable text (i.e. it is scanned). */
export async function pdfToLines(buffer: Buffer | Uint8Array): Promise<string[]> {
  const { getDocumentProxy } = await import("unpdf");
  // unpdf requires a plain Uint8Array — a Node Buffer (a Uint8Array subclass)
  // is rejected, so always copy into a fresh Uint8Array.
  const pdf = await getDocumentProxy(new Uint8Array(buffer));

  const lines: string[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const items: Item[] = [];
    for (const raw of content.items as Array<{ str?: string; transform?: number[] }>) {
      const str = raw.str ?? "";
      if (str.trim() === "" || !raw.transform) continue;
      items.push({ str, x: raw.transform[4], y: raw.transform[5], page: p });
    }
    // pdf y is bottom-up → sort top-to-bottom, then left-to-right.
    items.sort((a, b) => b.y - a.y || a.x - b.x);

    let cur: Item[] = [];
    let curY = Number.NaN;
    const flush = () => {
      if (!cur.length) return;
      cur.sort((a, b) => a.x - b.x);
      const line = cur.map((i) => i.str).join(" ").replace(/\s+/g, " ").trim();
      if (line) lines.push(line);
      cur = [];
    };
    for (const it of items) {
      if (!cur.length) {
        cur = [it];
        curY = it.y;
      } else if (Math.abs(it.y - curY) <= Y_TOL) {
        cur.push(it);
      } else {
        flush();
        cur = [it];
        curY = it.y;
      }
    }
    flush();
  }

  const totalChars = lines.reduce((n, l) => n + l.length, 0);
  if (lines.length < 3 || totalChars < 20) {
    throw new Error(
      "This PDF has no selectable text (it looks scanned). Please upload the Excel/CSV export or a text-based PDF.",
    );
  }
  return lines;
}
