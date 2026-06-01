/* Shared marketing landing template for tool subdomains.

   Lifted verbatim from the orgmis landing so every tool renders the same
   structure: two-column hero (pitch left; "Sample output" carousel right when
   slides are provided), "How it works" cards, trust pillars, "What's in your
   output" checklist, closing CTA, footer.

   Server component — it renders the client <OutputGallery/> as a child. It does
   NOT render <Nav/>; each page keeps its own Nav handling (some tools render Nav
   inline, orgmis gets it from its layout). Inline styles + CSS-var tokens, no
   Tailwind — matches the rest of core/ui.

   Feed it a per-tool config; see tools/orgmis/page.tsx and
   tools/gstledgerreco/page.tsx for examples. */

import type { ReactNode } from "react";
import { Card } from "./card";
import { Button } from "./button";
import { OutputGallery, type GallerySlide } from "./output-gallery";

type Cta = { label: string; href: string };
type Step = { n: string; title: string; body: string };
type Pillar = { title: string; body: string };

export type ToolLandingProps = {
  /** small mono eyebrow, e.g. "orgmis.kyveriqx.com · Board Reports in Minutes" */
  eyebrow: string;
  /** accent badge above the headline, e.g. "Generate board decks 100× faster" */
  claim: string;
  /** hero step pills, e.g. ["1. Branding", "2. Upload Data", ...] */
  stepStrip: string[];
  /** hero <h1> — pass JSX for multi-line / color-split headlines */
  headline: ReactNode;
  /** hero subheading paragraph */
  subhead: string;
  primaryCta: Cta;
  secondaryCta: Cta;
  /** "How it works" */
  stepsHeading: string;
  steps: Step[];
  /** trust pillars row */
  pillars: Pillar[];
  /** "What's in your output" */
  outputHeading: string;
  outputItems: string[];
  /** sample-output carousel slides; omit/empty → single-column hero, no carousel */
  gallerySlides?: GallerySlide[];
  footerLeft: string;
  footerRight?: string;
};

const EYEBROW: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 12,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: "var(--accent)",
};

export function ToolLanding({
  eyebrow,
  claim,
  stepStrip,
  headline,
  subhead,
  primaryCta,
  secondaryCta,
  stepsHeading,
  steps,
  pillars,
  outputHeading,
  outputItems,
  gallerySlides,
  footerLeft,
  footerRight,
}: ToolLandingProps) {
  const hasGallery = !!gallerySlides && gallerySlides.length > 0;

  return (
    <main style={{ maxWidth: 1240, margin: "0 auto", padding: "56px 24px 0" }}>
      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <section style={{ padding: "8px 0 56px" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: hasGallery
              ? "repeat(auto-fit, minmax(320px, 1fr))"
              : "1fr",
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
              {eyebrow}
            </div>

            {/* Step strip — preview of the wizard the user is about to enter */}
            <div
              style={{ display: "flex", flexWrap: "wrap", gap: 12, margin: "20px 0 28px" }}
            >
              {stepStrip.map((s) => (
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
              ))}
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
              {claim}
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
              {headline}
            </h1>

            <p
              style={{
                color: "var(--ink-300)",
                margin: "0 0 32px",
                fontSize: 18,
                lineHeight: 1.55,
                maxWidth: hasGallery ? undefined : 760,
              }}
            >
              {subhead}
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

          {/* Right: sample output carousel */}
          {hasGallery && (
            <div>
              <span style={{ ...EYEBROW, display: "block", marginBottom: 12 }}>
                Sample output
              </span>
              <OutputGallery slides={gallerySlides!} />
            </div>
          )}
        </div>
      </section>

      {/* ── How it works ──────────────────────────────────────────────── */}
      <section id="how" style={{ padding: "48px 0" }}>
        <div style={{ marginBottom: 28 }}>
          <span style={EYEBROW}>How it works</span>
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
            {stepsHeading}
          </h2>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 16,
          }}
        >
          {steps.map((s) => (
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
              <p style={{ fontSize: 14, lineHeight: 1.55, color: "var(--ink-300)", margin: 0 }}>
                {s.body}
              </p>
            </Card>
          ))}
        </div>
      </section>

      {/* ── Trust pillars ─────────────────────────────────────────────── */}
      <section style={{ padding: "32px 0 48px" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: 16,
          }}
        >
          {pillars.map((p) => (
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
              <p style={{ fontSize: 14, lineHeight: 1.55, color: "var(--ink-300)", margin: 0 }}>
                {p.body}
              </p>
            </Card>
          ))}
        </div>
      </section>

      {/* ── What's in your output ─────────────────────────────────────── */}
      <section style={{ padding: "48px 0" }}>
        <div style={{ marginBottom: 24 }}>
          <span style={EYEBROW}>What&apos;s in your output</span>
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
            {outputHeading}
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
            {outputItems.map((item, i) => (
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
        <span>{footerLeft}</span>
        {footerRight && <span style={{ fontFamily: "var(--font-mono)" }}>{footerRight}</span>}
      </footer>
    </main>
  );
}
