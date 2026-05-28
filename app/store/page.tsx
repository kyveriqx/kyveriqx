/* Store — store.kyveriqx.com (Architecture §1, §5).
   Catalogue is data-driven from the `tools` table per Architecture §9.
   Tools are partitioned into two visible sections (Plug & Play vs Hands-On
   Setup) via core/lib/tool-categories.ts. */

import type { User } from "@supabase/supabase-js";
import { Nav } from "../../core/ui/nav";
import { Card } from "../../core/ui/card";
import { SubscribeButton } from "../../core/ui/subscribe-button";
import { supabaseServer } from "../../core/lib/supabase-server";
import {
  CATEGORY_META,
  categoryFor,
  type ToolCategory,
} from "../../core/lib/tool-categories";

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

  const all = (tools as Tool[] | null) ?? [];
  const plugAndPlay = all.filter((t) => categoryFor(t.slug) === "plug-and-play");
  const handsOn     = all.filter((t) => categoryFor(t.slug) === "hands-on");

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
          Some tools you can start using in minutes with a 14-day free trial.
          Others need a quick implementation call so we can set them up against
          your systems.
        </p>

        {error && (
          <Card style={{ padding: 24, marginBottom: 24 }}>
            <p style={{ color: "var(--warn-fg)", margin: 0 }}>
              Couldn&apos;t load tools: {error.message}
            </p>
          </Card>
        )}

        <style
          dangerouslySetInnerHTML={{
            __html: `
              .store-section + .store-section { margin-top: 64px; }
              .store-section-head {
                display: flex; align-items: baseline; flex-wrap: wrap;
                gap: 10px;
                margin: 0 0 24px;
              }
              .store-section-title {
                font-size: 24px;
                font-weight: 600;
                color: var(--ink-100);
                letter-spacing: -0.015em;
                margin: 0;
              }
              .store-section-tagline {
                font-size: 14px;
                color: var(--ink-400);
              }
              .store-grid {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
                gap: 16px;
              }
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
              .store-tool-chip {
                display: inline-block;
                font-size: 10.5px;
                font-weight: 600;
                letter-spacing: 0.10em;
                padding: 3px 9px;
                border-radius: 999px;
                margin-bottom: 12px;
              }
              .store-tool-chip.chip-plug {
                color: var(--blue-400);
                background: var(--accent-bg-soft);
                border: 1px solid var(--accent-border-soft);
              }
              .store-tool-chip.chip-hands {
                color: var(--amber-fg);
                background: var(--amber-bg);
                border: 1px solid var(--amber-border);
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
              .store-book-call {
                display: inline-flex;
                align-items: center;
                gap: 6px;
                padding: 8px 14px;
                font-size: 13px;
                font-weight: 600;
                letter-spacing: -0.005em;
                border-radius: var(--radius-pill);
                background: linear-gradient(180deg, var(--accent-grad-start) 0%, var(--accent-grad-end) 100%);
                color: var(--accent-fg);
                box-shadow: 0 0 0 1px rgba(255,255,255,0.18) inset, 0 6px 18px -6px rgba(46,168,255,0.40), 0 0 20px -8px rgba(0,194,255,0.28);
                text-decoration: none;
                white-space: nowrap;
                transition: transform .25s var(--ease), box-shadow .25s var(--ease);
              }
              .store-book-call:hover { transform: translateY(-1px); }
              .store-price-custom {
                font-size: 14px;
                color: var(--ink-300);
                font-style: italic;
              }
            `,
          }}
        />

        {plugAndPlay.length > 0 && (
          <CategorySection
            category="plug-and-play"
            tools={plugAndPlay}
            user={user}
          />
        )}

        {handsOn.length > 0 && (
          <CategorySection
            category="hands-on"
            tools={handsOn}
            user={user}
          />
        )}
      </main>
    </>
  );
}

function CategorySection({
  category,
  tools,
  user,
}: {
  category: ToolCategory;
  tools: Tool[];
  user: User | null;
}) {
  const meta = CATEGORY_META[category];
  return (
    <section className="store-section">
      <header className="store-section-head">
        <h2 className="store-section-title">{meta.title}</h2>
        <span className="store-section-tagline">({meta.tagline})</span>
      </header>
      <div className="store-grid">
        {tools.map((tool) => (
          <ToolCard key={tool.id} tool={tool} category={category} user={user} />
        ))}
      </div>
    </section>
  );
}

function ToolCard({
  tool,
  category,
  user,
}: {
  tool: Tool;
  category: ToolCategory;
  user: User | null;
}) {
  const meta = CATEGORY_META[category];
  const isHandsOn = category === "hands-on";

  return (
    <Card className="store-tool-card" style={{ padding: 20 }}>
      <a
        href={`https://${tool.subdomain}.kyveriqx.com`}
        className="store-tool-link-region"
        aria-label={`Open ${tool.name}`}
      >
        <span
          className={`store-tool-chip ${isHandsOn ? "chip-hands" : "chip-plug"}`}
        >
          {meta.chip}
        </span>
        <span
          style={{
            display: "block",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            letterSpacing: "0.06em",
            color: "var(--ink-400)",
          }}
        >
          {tool.subdomain}.kyveriqx.com
        </span>
        <h3
          style={{
            fontSize: 20,
            fontWeight: 600,
            margin: "6px 0 8px",
            color: "var(--ink-100)",
          }}
        >
          {tool.name}
        </h3>
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
        {isHandsOn ? (
          <span className="store-price-custom">Custom pricing</span>
        ) : (
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
        )}

        {isHandsOn ? (
          <a href="/#book" className="store-book-call">
            Book a call →
          </a>
        ) : user ? (
          <SubscribeButton
            toolSlug={tool.slug}
            userEmail={user.email ?? undefined}
            label="Get yours now"
            size="sm"
          />
        ) : (
          <a href="/auth/login?next=/store" className="store-tool-signin">
            Sign in to subscribe →
          </a>
        )}
      </div>
    </Card>
  );
}
