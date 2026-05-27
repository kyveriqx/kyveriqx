/* Tool registry helpers — Architecture §8.4.

   Every API route + server component that operates on uploads / jobs
   needs the tool's UUID (RLS scopes most rows on tool_id). Looking it
   up by slug is a one-liner but copy-pasting it across 4+ call sites
   stops being cute when a third tool joins. */

import type { SupabaseClient } from "@supabase/supabase-js";

/** Return the tools.id for a given slug, or null if no row matches.
 *  Pass any Supabase client (anon or service-role) — RLS on `tools`
 *  allows public SELECT for active rows. */
export async function getToolId(
  supabase: SupabaseClient,
  slug: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("tools")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (error || !data) return null;
  return data.id as string;
}
