/* Tiny mail-merge helper.

   v1 supports a single field: {{name}}. The token is case-insensitive
   and tolerates inner whitespace (`{{ Name }}`), so a hand-typed
   template doesn't break on small inconsistencies. Missing names yield
   the empty string — the surrounding template controls the fallback
   ("Hi {{name}}," becomes "Hi ," which is the user's choice to make). */

const TOKEN_RE = /\{\{\s*name\s*\}\}/gi;

export function applyMerge(template: string, row: { name?: string }): string {
  const name = (row.name ?? "").trim();
  return template.replace(TOKEN_RE, name);
}
