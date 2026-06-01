"use client";

/* Sample-output carousel for tool landing pages.

   Pure CSS scroll-snap track + a thin layer of state for the prev/next
   arrows and dot indicators — no carousel library. Inline styles + CSS-var
   tokens to match the rest of core/ui.

   Each slide is full-width within its container; the track snaps one slide at
   a time, so the active index is simply round(scrollLeft / clientWidth).

   Clicking a slide opens it in a lightbox (zoom over a dark backdrop, with
   prev/next, Esc-to-close and body-scroll-lock).

   Images live under /public. If a file isn't present yet the <img> onError
   swaps in a neutral placeholder showing the caption, so a landing page is
   reviewable before its real mockups are dropped in. */

import { useCallback, useEffect, useRef, useState } from "react";

export type GallerySlide = { src: string; caption: string };

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

/* Controls inside the dark lightbox overlay (light-on-dark). */
const OVERLAY_BTN: React.CSSProperties = {
  position: "absolute",
  width: 44,
  height: 44,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.4)",
  background: "rgba(255,255,255,0.12)",
  color: "#fff",
  fontSize: 24,
  cursor: "pointer",
  lineHeight: 1,
};

export function OutputGallery({ slides }: { slides: GallerySlide[] }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);

  const scrollTo = useCallback(
    (i: number) => {
      const track = trackRef.current;
      if (!track) return;
      const clamped = Math.max(0, Math.min(i, slides.length - 1));
      track.scrollTo({ left: clamped * track.clientWidth, behavior: "smooth" });
    },
    [slides.length],
  );

  const onScroll = useCallback(() => {
    const track = trackRef.current;
    if (!track || track.clientWidth === 0) return;
    setIndex(Math.round(track.scrollLeft / track.clientWidth));
  }, []);

  // Lightbox: which slide is zoomed open (null = closed).
  const [zoom, setZoom] = useState<number | null>(null);
  const stepZoom = useCallback(
    (d: number) => {
      setZoom((z) => (z === null ? z : (z + d + slides.length) % slides.length));
    },
    [slides.length],
  );

  // While the lightbox is open: arrow keys navigate, Esc closes, and the
  // page behind it is locked from scrolling.
  useEffect(() => {
    if (zoom === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setZoom(null);
      else if (e.key === "ArrowRight") stepZoom(1);
      else if (e.key === "ArrowLeft") stepZoom(-1);
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [zoom, stepZoom]);

  if (slides.length === 0) return null;

  return (
    <div>
      {/* hide the scrollbar on the snap track (webkit needs a real rule) */}
      <style>{`.kvx-gallery-track::-webkit-scrollbar{display:none}`}</style>

      <div
        ref={trackRef}
        className="kvx-gallery-track"
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
        {slides.map((s, i) => (
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
                loading={i === 0 ? "eager" : "lazy"}
                onClick={() => setZoom(i)}
                title="Click to enlarge"
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
                  objectFit: "contain",
                  background: "var(--bg-card)",
                  cursor: "zoom-in",
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
          {slides.map((s, i) => (
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
                background: i === index ? "var(--accent)" : "var(--line-strong)",
                transition: "width .25s var(--ease), background .25s var(--ease)",
              }}
            />
          ))}
        </div>

        <button
          type="button"
          aria-label="Next"
          onClick={() => scrollTo(index + 1)}
          style={{ ...ARROW, opacity: index === slides.length - 1 ? 0.4 : 1 }}
        >
          ›
        </button>
      </div>

      {/* Lightbox — click a slide to enlarge it over a dark backdrop */}
      {zoom !== null && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={slides[zoom].caption}
          onClick={() => setZoom(null)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            background: "rgba(0,0,0,0.82)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
        >
          <button
            type="button"
            aria-label="Close"
            onClick={() => setZoom(null)}
            style={{ ...OVERLAY_BTN, top: 16, right: 20 }}
          >
            ×
          </button>
          <button
            type="button"
            aria-label="Previous"
            onClick={(e) => {
              e.stopPropagation();
              stepZoom(-1);
            }}
            style={{ ...OVERLAY_BTN, left: 16, top: "50%", transform: "translateY(-50%)" }}
          >
            ‹
          </button>

          <figure
            onClick={(e) => e.stopPropagation()}
            style={{ margin: 0, maxWidth: "min(1100px, 92vw)", textAlign: "center" }}
          >
            <img
              src={slides[zoom].src}
              alt={slides[zoom].caption}
              style={{
                display: "block",
                maxWidth: "100%",
                maxHeight: "82vh",
                objectFit: "contain",
                margin: "0 auto",
                borderRadius: "var(--radius-lg)",
                background: "#fff",
                boxShadow: "0 24px 60px -12px rgba(0,0,0,0.6)",
              }}
            />
            <figcaption
              style={{ marginTop: 14, color: "rgba(255,255,255,0.85)", fontSize: 14 }}
            >
              {slides[zoom].caption} · {zoom + 1} / {slides.length}
            </figcaption>
          </figure>

          <button
            type="button"
            aria-label="Next"
            onClick={(e) => {
              e.stopPropagation();
              stepZoom(1);
            }}
            style={{ ...OVERLAY_BTN, right: 16, top: "50%", transform: "translateY(-50%)" }}
          >
            ›
          </button>
        </div>
      )}
    </div>
  );
}
