/* Management / BOD MIS Generator — Architecture §8.5.

   Marketing-style landing page for the tool. Same hero for signed-out
   (with "Start free trial / Log in" CTAs) and signed-in (with
   "Get Started / Skip to Upload" CTAs) — the surrounding sections
   ("How it works", trust strip, "What's in your report") render in
   both states, so signed-out visitors get the full pitch too.

   The page is rendered inside app/tools/orgmis/layout.tsx, which wraps
   it in <Nav /> and inherits data-theme="light" from app/tools/layout. */

import { Card } from "../../core/ui/card";
import { Button } from "../../core/ui/button";
import { OutputGallery, HeroShot } from "./components/OutputGallery";
import { supabaseServer } from "../../core/lib/supabase-server";
import { loginHrefWithReturn } from "../../core/lib/subdomain";

export const dynamic = "force-dynamic";

const STEPS = [
  {
    n: "01",
    title: "Set up your branding",
    body: "Logo, company name, tagline, vision. Saved for next time.",
  },
  {
    n: "02",
    title: "Upload your data",
    body: "GL/Trial Balance, Sales, Purchase, Inventory. Drag & drop.",
  },
  {
    n: "03",
    title: "Preview KPIs live",
    body: "Revenue, EBITDA, margins, top customers — all in your browser.",
  },
  {
    n: "04",
    title: "Generate & download",
    body: "Excel MIS + PPT deck + PDF, all branded with your identity.",
  },
];

const PILLARS = [
  {
    title: "Fast",
    body: "From raw export to board-ready PDF in under 60 seconds.",
  },
  {
    title: "Reliable",
    body: "Heavy lifting runs on Trigger.dev — retries, durability, observability.",
  },
  {
    title: "Repeatable",
    body: "Branding saved. Every quarter, every year, one-click refresh.",
  },
];

const REPORT_CONTENTS = [
  "Cover & Agenda",
  "Company Snapshot",
  "Financial Highlights (Revenue, EBITDA, PAT)",
  "Detailed P&L Statement",
  "Monthly Revenue Trend",
  "Top Customers & Vendors",
  "Geographic & Currency Mix",
  "Working Capital Analysis (DSO/DPO/CCC)",
  "Key Achievements",
  "Strategic Outlook FY 2025-26",
  "Risks, Asks & Discussion",
  "Margin Profile",
  "GL Category Summary",
  "Notes & Assumptions",
];

export default async function OrgMisLanding() {
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  const primaryCta = user
    ? { label: "Get Started", href: "/tools/orgmis/settings" }
    : { label: "Start free trial", href: "/auth/register" };
  const secondaryCta = user
    ? { label: "Skip to Upload", href: "/tools/orgmis/upload" }
    : { label: "Log in", href: loginHrefWithReturn() };

  return (
    <main style={{ maxWidth: 1240, margin: "0 auto", padding: "56px 24px 0" }}>
      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <section style={{ padding: "8px 0 56px" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
            gap: 40,
            alignItems: "center",
          }}
        >
          {/* Left: pitch + CTAs */}
          <div>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            letterSpacing: "0.08em",
            color: "var(--ink-400)",
            textTransform: "uppercase",
          }}
        >
          orgmis.kyveriqx.com · Board Reports in Minutes
        </div>

        {/* Step strip — preview of the 4-step wizard the user is about to enter */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 12,
            margin: "20px 0 28px",
          }}
        >
          {["1. Branding", "2. Upload Data", "3. Preview", "4. Generate"].map(
            (s) => (
              <span
                key={s}
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 12.5,
                  padding: "6px 12px",
                  borderRadius: "var(--radius-badge)",
                  border: "1px solid var(--accent-border-soft)",
                  background: "var(--accent-bg-soft)",
                  color: "var(--ink-200)",
                  letterSpacing: "0.02em",
                }}
              >
                {s}
              </span>
            ),
          )}
        </div>

        <div
          style={{
            display: "inline-block",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "var(--accent)",
            padding: "4px 10px",
            borderRadius: "var(--radius-badge)",
            background: "var(--accent-bg-soft)",
            border: "1px solid var(--accent-border-soft)",
            marginBottom: 18,
          }}
        >
          Generate board decks 100× faster
        </div>

        <h1
          style={{
            fontSize: "clamp(40px, 5.2vw, 72px)",
            lineHeight: 1.04,
            letterSpacing: "-0.025em",
            fontWeight: 700,
            margin: "0 0 20px",
            color: "var(--ink-100)",
          }}
        >
          Board reports.
          <br />
          <span style={{ color: "var(--ink-200)" }}>
            In minutes, not weeks.
          </span>
        </h1>

        <p
          style={{
            color: "var(--ink-300)",
            margin: "0 0 32px",
            fontSize: 18,
            lineHeight: 1.55,
          }}
        >
          Upload your ERP exports — GL, Sales, Purchase, Inventory. Customize
          your branding. Download a board-ready Excel MIS, PowerPoint deck, and
          PDF.
        </p>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          <a href={primaryCta.href}>
            <Button>{primaryCta.label} →</Button>
          </a>
          <a href={secondaryCta.href}>
            <Button variant="ghost">{secondaryCta.label}</Button>
          </a>
        </div>
          </div>

          {/* Right: sample output preview */}
          <Card style={{ padding: 0 }}>
            <HeroShot
              src="/tools/orgmis/out-2-highlights.png"
              alt="Sample Financial Highlights slide generated by the tool"
            />
          </Card>
        </div>
      </section>

      {/* ── See the output ────────────────────────────────────────────── */}
      <section style={{ padding: "16px 0 48px" }}>
        <div style={{ marginBottom: 28 }}>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "var(--accent)",
            }}
          >
            See the output
          </span>
          <h2
            style={{
              fontSize: "clamp(26px, 3vw, 36px)",
              lineHeight: 1.15,
              letterSpacing: "-0.02em",
              fontWeight: 700,
              margin: "10px 0 8px",
              color: "var(--ink-100)",
            }}
          >
            Board-ready PPT, Excel MIS and PDF — straight from your ERP export.
          </h2>
        </div>

        <OutputGallery />
      </section>

      {/* ── How it works ──────────────────────────────────────────────── */}
      <section id="how" style={{ padding: "48px 0" }}>
        <div style={{ marginBottom: 28 }}>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "var(--accent)",
            }}
          >
            How it works
          </span>
          <h2
            style={{
              fontSize: "clamp(26px, 3vw, 36px)",
              lineHeight: 1.15,
              letterSpacing: "-0.02em",
              fontWeight: 700,
              margin: "10px 0 8px",
              color: "var(--ink-100)",
            }}
          >
            Four simple steps. No spreadsheet wrestling.
          </h2>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 16,
          }}
        >
          {STEPS.map((s) => (
            <Card key={s.n} style={{ padding: 22 }}>
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 13,
                  color: "var(--accent)",
                  fontWeight: 600,
                  marginBottom: 10,
                }}
              >
                {s.n}
              </div>
              <h3
                style={{
                  fontSize: 17,
                  fontWeight: 700,
                  color: "var(--ink-200)",
                  margin: "0 0 8px",
                  letterSpacing: "-0.01em",
                }}
              >
                {s.title}
              </h3>
              <p
                style={{
                  fontSize: 14,
                  lineHeight: 1.55,
                  color: "var(--ink-300)",
                  margin: 0,
                }}
              >
                {s.body}
              </p>
            </Card>
          ))}
        </div>
      </section>

      {/* ── Trust pillars: Fast / Reliable / Repeatable ──────────────── */}
      <section style={{ padding: "32px 0 48px" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: 16,
          }}
        >
          {PILLARS.map((p) => (
            <Card key={p.title} style={{ padding: 22 }}>
              <h3
                style={{
                  fontSize: 18,
                  fontWeight: 700,
                  color: "var(--ink-200)",
                  margin: "0 0 8px",
                  letterSpacing: "-0.01em",
                }}
              >
                {p.title}
              </h3>
              <p
                style={{
                  fontSize: 14,
                  lineHeight: 1.55,
                  color: "var(--ink-300)",
                  margin: 0,
                }}
              >
                {p.body}
              </p>
            </Card>
          ))}
        </div>
      </section>

      {/* ── What's in your report ─────────────────────────────────────── */}
      <section style={{ padding: "48px 0" }}>
        <div style={{ marginBottom: 24 }}>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "var(--accent)",
            }}
          >
            What's in your report
          </span>
          <h2
            style={{
              fontSize: "clamp(26px, 3vw, 36px)",
              lineHeight: 1.15,
              letterSpacing: "-0.02em",
              fontWeight: 700,
              margin: "10px 0 8px",
              color: "var(--ink-100)",
            }}
          >
            Up to 15 data-driven slides + 10-sheet MIS workbook + locked PDF.
          </h2>
        </div>

        <Card style={{ padding: 24 }}>
          <ul
            style={{
              listStyle: "none",
              padding: 0,
              margin: 0,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
              gap: 10,
            }}
          >
            {REPORT_CONTENTS.map((item, i) => (
              <li
                key={item}
                style={{
                  display: "grid",
                  gridTemplateColumns: "28px 1fr",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 4px",
                  borderTop: i === 0 ? "none" : "1px dashed var(--line)",
                  color: "var(--ink-200)",
                  fontSize: 14.5,
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    color: "var(--accent)",
                    fontWeight: 600,
                  }}
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </Card>
      </section>

      {/* ── Closing CTA ──────────────────────────────────────────────── */}
      <section style={{ padding: "32px 0 24px", textAlign: "center" }}>
        <a href={primaryCta.href}>
          <Button>{primaryCta.label} →</Button>
        </a>
      </section>

      <footer
        style={{
          padding: "32px 0 48px",
          borderTop: "1px solid var(--line)",
          marginTop: 32,
          color: "var(--ink-400)",
          fontSize: 13,
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <span>© BOD MIS Tool — Built for finance teams.</span>
        <span style={{ fontFamily: "var(--font-mono)" }}>
          Powered by Vercel + Trigger.dev
        </span>
      </footer>
    </main>
  );
}
