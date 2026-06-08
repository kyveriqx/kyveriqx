/* Shared admin data loaders. events/jobs reference auth.users and tools by id
   but Supabase can't auto-join events→profiles (no FK between them), so we
   resolve names/emails with small lookup maps built here. All reads use the
   service role — the caller (an admin page) is already gated by requireAdmin. */

import { supabaseAdmin } from "../../../core/lib/supabase";

export type ToolInfo = { id: string; slug: string; name: string; price: number };

export async function loadTools(): Promise<ToolInfo[]> {
  const admin = supabaseAdmin();
  const { data } = await admin
    .from("tools")
    .select("id, slug, name, price")
    .order("name");
  return (data ?? []).map((t) => ({
    id: t.id as string,
    slug: t.slug as string,
    name: t.name as string,
    price: Number(t.price),
  }));
}

export async function toolsById(): Promise<Map<string, ToolInfo>> {
  const tools = await loadTools();
  return new Map(tools.map((t) => [t.id, t]));
}

/** email by user id, for a set of ids (deduped). */
export async function emailsByUserId(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = Array.from(new Set(ids.filter((x): x is string => !!x)));
  if (unique.length === 0) return new Map();
  const admin = supabaseAdmin();
  const { data } = await admin.from("profiles").select("id, email").in("id", unique);
  return new Map((data ?? []).map((p) => [p.id as string, (p.email as string) ?? ""]));
}

/** Count helper: returns the exact row count for a filtered query without
 *  fetching rows (head + count). `build` may chain .eq/.gt/etc. filters. */
export async function countRows(
  table: string,
  build?: (q: any) => any,
): Promise<number> {
  const admin = supabaseAdmin();
  const base = admin.from(table).select("*", { count: "exact", head: true });
  const q = build ? build(base) : base;
  const { count } = await q;
  return count ?? 0;
}
