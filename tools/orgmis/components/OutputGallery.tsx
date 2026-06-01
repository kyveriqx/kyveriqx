"use client";

/* "See the output" carousel for the orgmis landing page.

   Pure CSS scroll-snap track + a thin layer of state for the prev/next
   arrows and dot indicators — no carousel library. Inline styles + CSS-var
   tokens to match core/ui (NOT the Tailwind components/ui.tsx).

   Each slide is full-width; the track snaps one slide at a time, so the
   active index is simply round(scrollLeft / clientWidth).

   Images live in /public/tools/orgmis/. If a file isn't present yet the
   <img> onError swaps in a neutral placeholder showing the caption, so the
   layout is reviewable before the real mockups are dropped in. */

import { useCallback, useRef, useState } from "react";

type Slide = { src: string; caption: string };

const SLIDES: Slide[] = [
  { src: "/tools/orgmis/out-1-cover.png", caption: "Branded PPT cover slide" },
  {
    src: "/tools/orgmis/out-2-highlights.png",
    caption: "Financial Highlights — Revenue, EBITDA, PAT at a glance",
  },
  { src: "/tools/orgmis/out-3-trends.png", caption: "Revenue & margin trends" },
  {
    src: "/tools/orgmis/out-4-customers.png",
    caption: "Top customers & vendors",
  },
  {
    src: "/tools/orgmis/out-5-excel.png",
    caption: "10-sheet Excel MIS workbook",
  },
  { src: "/tools/orgmis/out-6-pdf.png", caption: "Board-ready PDF report" },
];

/* Single hero image with the same fail-soft placeholder as the carousel.
   Lives in a client component because the orgmis page is a server component
   and can't attach an onError handler to a plain <img>. */
export function HeroShot({ src, alt }: { src: string; alt: string }) {
  return (
    <>
      <img
        src={src}
        alt={alt}
        onError={(e) => {
          const img = e.currentTarget;
          img.style.display = "none";
          const ph = img.nextElementSibling as HTMLElement | null;
          if (ph) ph.style.display = "flex";
        }}
        style={{
          display: "block",
          width: "100%",
          aspectRatio: "16 / 9",
          objectFit: "cover",
        }}
      />
      <div
        style={{
          display: "none",
          width: "100%",
          aspectRatio: "16 / 9",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          textAlign: "center",
          background: "var(--accent-bg-soft)",
          color: "var(--ink-300)",
          fontFamily: "var(--font-mono)",
          fontSize: 13,
        }}
      >
        {alt}
      </div>
    </>
  );
}

const ARROW: React.CSSProperties = {
  width: 40,
  height: 40,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: "var(--radius-pill)",
  border: "1px solid var(--line-strong)",
  background: "var(--bg-elev)",
  color: "var(--ink-100)",
  fontSize: 18,
  cursor: "pointer",
  lineHeight: 1,
};

export function OutputGallery() {
  const trackRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);

  const scrollTo = useCallback((i: number) => {
    const track = trackRef.current;
    if (!track) return;
    const clamped = Math.max(0, Math.min(i, SLIDES.length - 1));
    track.scrollTo({ left: clamped * track.clientWidth, behavior: "smooth" });
  }, []);

  const onScroll = useCallback(() => {
    const track = trackRef.current;
    if (!track || track.clientWidth === 0) return;
    setIndex(Math.round(track.scrollLeft / track.clientWidth));
  }, []);

  return (
    <div>
      {/* hide the scrollbar on the snap track (webkit needs a real rule) */}
      <style>{`.orgmis-gallery-track::-webkit-scrollbar{display:none}`}</style>

      <div
        ref={trackRef}
        className="orgmis-gallery-track"
        onScroll={onScroll}
        style={{
          display: "flex",
          overflowX: "auto",
          scrollSnapType: "x mandatory",
          scrollbarWidth: "none",
          msOverflowStyle: "none",
          borderRadius: "var(--radius-lg)",
        }}
      >
        {SLIDES.map((s) => (
          <div
            key={s.src}
            style={{
              flex: "0 0 100%",
              scrollSnapAlign: "start",
              boxSizing: "border-box",
            }}
          >
            <div
              style={{
                background: "var(--bg-card)",
                border: "1px solid var(--line)",
                borderRadius: "var(--radius-lg)",
                boxShadow: "var(--shadow-card)",
                overflow: "hidden",
              }}
            >
              <img
                src={s.src}
                alt={s.caption}
                onError={(e) => {
                  const img = e.currentTarget;
                  img.style.display = "none";
                  const ph = img.nextElementSibling as HTMLElement | null;
                  if (ph) ph.style.display = "flex";
                }}
                style={{
                  display: "block",
                  width: "100%",
                  aspectRatio: "16 / 9",
                  objectFit: "cover",
                }}
              />
              {/* placeholder shown only if the image fails to load */}
              <div
                style={{
                  display: "none",
                  width: "100%",
                  aspectRatio: "16 / 9",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 24,
                  textAlign: "center",
                  background: "var(--accent-bg-soft)",
                  color: "var(--ink-300)",
                  fontFamily: "var(--font-mono)",
                  fontSize: 13,
                }}
              >
                {s.caption}
              </div>
            </div>
            <p
              style={{
                margin: "12px 4px 0",
                fontSize: 13.5,
                color: "var(--ink-300)",
                textAlign: "center",
              }}
            >
              {s.caption}
            </p>
          </div>
        ))}
      </div>

      {/* controls: arrows + dots */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          marginTop: 20,
        }}
      >
        <button
          type="button"
          aria-label="Previous"
          onClick={() => scrollTo(index - 1)}
          style={{ ...ARROW, opacity: index === 0 ? 0.4 : 1 }}
        >
          ‹
        </button>

        <div style={{ display: "flex", gap: 8 }}>
          {SLIDES.map((s, i) => (
            <button
              key={s.src}
              type="button"
              aria-label={`Go to slide ${i + 1}`}
              onClick={() => scrollTo(i)}
              style={{
                width: i === index ? 22 : 8,
                height: 8,
                padding: 0,
                border: "none",
                borderRadius: 999,
                cursor: "pointer",
                background:
                  i === index ? "var(--accent)" : "var(--line-strong)",
                transition: "width .25s var(--ease), background .25s var(--ease)",
              }}
            />
          ))}
        </div>

        <button
          type="button"
          aria-label="Next"
          onClick={() => scrollTo(index + 1)}
          style={{
            ...ARROW,
            opacity: index === SLIDES.length - 1 ? 0.4 : 1,
          }}
        >
          ›
        </button>
      </div>
    </div>
  );
}
