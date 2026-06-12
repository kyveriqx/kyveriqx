/* Address-list parsing for fixed CC/BCC fields.

   The compose forms let the user type a comma- (or semicolon-) separated
   list of addresses to CC/BCC on every send. We split, trim, lower-case,
   drop blanks, and keep only addresses that pass a basic sanity check —
   real validity is decided by the mail server on send. Duplicates are
   removed so the same inbox isn't listed twice. */

// Same RFC-5321-ish sanity check the recipient parsers use — enough to drop
// typos and stray text without re-implementing the spec.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Parse a free-text CC/BCC field into a de-duplicated list of valid,
 *  lower-cased addresses. Returns [] for empty/whitespace input. */
export function parseAddressList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of String(raw).split(/[,;]+/)) {
    const addr = part.trim().toLowerCase();
    if (!addr || !EMAIL_RE.test(addr) || seen.has(addr)) continue;
    seen.add(addr);
    out.push(addr);
  }
  return out;
}
