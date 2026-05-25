/* Store — store.kyveriqx.com (Architecture §1, §5).
   Catalogue is data-driven from the `tools` table per Architecture §9. */

import { Nav } from "../../core/ui/nav";
import { Card } from "../../core/ui/card";
import { supabaseServer } from "../../core/lib/supabase-server";

type Tool = {
  id: string;
  slug: string;
  subdomain: string;
  name: string;
  description: string | null;
  price: number;
};

export const dynamic = "force-dynamic";

export default async function Store() {
  const supabase = supabaseServer();
  const { data: tools, error } = await supabase
    .from("tools")
    .select("id, slug, subdomain, name, description, price")
    .eq("is_active", true)
    .order("created_at");

  return (
    <>
      <Nav />
      <main style={{ maxWidth: 1240, margin: "0 auto", padding: "80px 24px" }}>
        <h1
          style={{
            fontSize: "clamp(32px, 3.6vw, 52px)",
            lineHeight: 1.06,
            letterSpacing: "-0.022em",
            fontWeight: 600,
            margin: "0 0 16px",
          }}
        >
          Tool catalogue
        </h1>
        <p style={{ color: "var(--ink-300)", maxWidth: 720, margin: "0 0 48px", fontSize: 16 }}>
          Every tool gets its own subdomain and a 14-day free trial on signup.
          After the trial, ₹X / month per tool.
        </p>

        {error && (
          <Card style={{ padding: 24, marginBottom: 24 }}>
            <p style={{ color: "#FFB3B3", margin: 0 }}>
              Couldn't load tools: {error.message}
            </p>
          </Card>
        )}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: 16,
          }}
        >
          {(tools as Tool[] | null)?.map((tool) => (
            <Card key={tool.id} style={{ padding: 20 }}>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  letterSpacing: "0.06em",
                  color: "var(--ink-400)",
                }}
              >
                {tool.subdomain}.kyveriqx.com
              </span>
              <h2
                style={{
                  fontSize: 20,
                  fontWeight: 600,
                  margin: "6px 0 8px",
                  color: "var(--ink-100)",
                }}
              >
                {tool.name}
              </h2>
              <p
                style={{
                  fontSize: 14,
                  color: "var(--ink-300)",
                  lineHeight: 1.5,
                  margin: "0 0 16px",
                  minHeight: 42,
                }}
              >
                {tool.description ?? ""}
              </p>
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 6,
                }}
              >
                <span
                  style={{
                    fontSize: 20,
                    fontWeight: 600,
                    color: "var(--blue-400)",
                  }}
                >
                  ₹{Number(tool.price).toFixed(0)}
                </span>
                <span style={{ color: "var(--ink-400)", fontSize: 13 }}>/ month</span>
              </div>
            </Card>
          ))}
        </div>
      </main>
    </>
  );
}
