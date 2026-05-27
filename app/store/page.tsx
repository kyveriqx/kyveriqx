/* Store — store.kyveriqx.com (Architecture §1, §5).
   Catalogue is data-driven from the `tools` table per Architecture §9. */

import { Nav } from "../../core/ui/nav";
import { Card } from "../../core/ui/card";
import { SubscribeButton } from "../../core/ui/subscribe-button";
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

  const { data: { user } } = await supabase.auth.getUser();

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
          Kyveriqx Stack
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

        <style
          dangerouslySetInnerHTML={{
            __html: `
              .store-tool-card {
                display: flex;
                flex-direction: column;
                transition: transform .25s var(--ease), box-shadow .25s var(--ease), border-color .25s var(--ease);
              }
              .store-tool-card:hover {
                transform: translateY(-4px);
                border-color: rgba(46, 168, 255, 0.32);
                box-shadow: 0 20px 60px -20px rgba(46, 168, 255, 0.35);
              }
              .store-tool-link-region {
                display: block;
                text-decoration: none;
                color: inherit;
                flex: 1;
              }
              .store-tool-footer {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
                margin-top: 16px;
                padding-top: 16px;
                border-top: 1px solid var(--line);
              }
              .store-tool-signin {
                font-size: 13px;
                color: var(--blue-400);
                text-decoration: none;
                white-space: nowrap;
              }
              .store-tool-signin:hover { text-decoration: underline; }
            `,
          }}
        />

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: 16,
          }}
        >
          {(tools as Tool[] | null)?.map((tool) => (
            <Card key={tool.id} className="store-tool-card" style={{ padding: 20 }}>
              <a
                href={`https://${tool.subdomain}.kyveriqx.com`}
                className="store-tool-link-region"
                aria-label={`Open ${tool.name}`}
              >
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
              </a>

              <div className="store-tool-footer">
                <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
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

                {user ? (
                  <SubscribeButton
                    toolSlug={tool.slug}
                    userEmail={user.email ?? undefined}
                    label="Get yours now"
                    size="sm"
                  />
                ) : (
                  <a
                    href="/auth/login?next=/store"
                    className="store-tool-signin"
                  >
                    Sign in to subscribe →
                  </a>
                )}
              </div>
            </Card>
          ))}
        </div>
      </main>
    </>
  );
}
