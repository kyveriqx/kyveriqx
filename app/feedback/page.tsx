/* Public feedback hub: leave a review, report a bug, or request a new tool.
   The tool dropdown (for bug reports / requests) is seeded from the catalogue.
   Submitting requires sign-in (the action is RLS-scoped to the user). */

import { Nav } from "../../core/ui/nav";
import { Card } from "../../core/ui/card";
import { supabaseServer } from "../../core/lib/supabase-server";
import { loginHrefWithReturn } from "../../core/lib/subdomain";
import { FeedbackForm } from "./feedback-form";

export const dynamic = "force-dynamic";

export default async function FeedbackPage() {
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: tools } = await supabase
    .from("tools")
    .select("slug, name")
    .eq("is_active", true)
    .order("name");

  return (
    <>
      <Nav />
      <main style={{ maxWidth: 680, margin: "0 auto", padding: "64px 24px" }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: "0 0 8px" }}>Tell us what you think</h1>
        <p style={{ color: "var(--ink-300)", fontSize: 15, margin: "0 0 24px", lineHeight: 1.6 }}>
          Leave a review, report a bug, or ask for a new tool. We read every one.
        </p>
        <Card style={{ padding: 24 }}>
          {user ? (
            <FeedbackForm tools={(tools ?? []).map((t) => ({ slug: t.slug as string, name: t.name as string }))} />
          ) : (
            <div style={{ fontSize: 15, color: "var(--ink-200)" }}>
              Please{" "}
              <a href={loginHrefWithReturn()} style={{ color: "var(--accent)" }}>sign in</a>{" "}
              to send feedback.
            </div>
          )}
        </Card>
      </main>
    </>
  );
}
