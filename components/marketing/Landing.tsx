"use client";

import React, { useState, useRef, useEffect, useMemo, Fragment } from "react";

/* ===== Shared utilities (from Block 1) ===== */

// IntersectionObserver-driven reveal-on-scroll.
function useReveal(threshold: number = 0.15) {
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('is-in');
            io.unobserve(e.target);
          }
        });
      },
      { threshold, rootMargin: '0px 0px -10% 0px' }
    );
    el.querySelectorAll('.reveal').forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, []);
  return ref;
}

// Animated counter — counts up when in view
function Counter({
  to,
  prefix = '',
  suffix = '',
  duration = 1800,
  decimals = 0,
}: {
  to: number;
  prefix?: string;
  suffix?: string;
  duration?: number;
  decimals?: number;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [val, setVal] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf: number;
    let started = false;
    const start = () => {
      if (started) return;
      started = true;
      const t0 = performance.now();
      const tick = (now: number) => {
        const p = Math.min(1, (now - t0) / duration);
        // easeOutCubic
        const eased = 1 - Math.pow(1 - p, 3);
        setVal(to * eased);
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };
    // If the element is already on screen at mount time, start immediately —
    // IntersectionObserver's initial callback is unreliable under React 18
    // StrictMode double-mounting.
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight && rect.bottom > 0) {
      start();
      return () => cancelAnimationFrame(raf);
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            start();
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.4 }
    );
    io.observe(el);
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
  }, [to, duration]);
  const formatted = decimals
    ? val.toFixed(decimals)
    : Math.round(val).toLocaleString();
  return <span ref={ref} className="numeral">{prefix}{formatted}{suffix}</span>;
}

// Magnetic button — slight pull toward cursor
function Magnetic({
  children,
  strength = 14,
  className = '',
  ...rest
}: {
  children: React.ReactNode;
  strength?: number;
  className?: string;
  [key: string]: any;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const onMove = (e: React.MouseEvent<HTMLSpanElement>) => {
    const el = ref.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left - r.width / 2) / r.width;
    const y = (e.clientY - r.top - r.height / 2) / r.height;
    el.style.transform = `translate(${x * strength}px, ${y * strength}px)`;
  };
  const onLeave = () => {
    const el = ref.current; if (!el) return;
    el.style.transform = 'translate(0,0)';
  };
  return (
    <span
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      className={className}
      style={{ display: 'inline-block', transition: 'transform .35s cubic-bezier(.2,.7,.2,1)' }}
      {...rest}
    >
      {children}
    </span>
  );
}

// Mouse parallax — returns a {x,y} normalized to [-1,1] relative to a ref
function useMouseParallax() {
  const ref = useRef<HTMLElement | null>(null);
  const [p, setP] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  useEffect(() => {
    const el = ref.current; if (!el) return;
    let raf: number;
    const onMove = (e: MouseEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        const x = (e.clientX - r.left - r.width / 2) / r.width;
        const y = (e.clientY - r.top - r.height / 2) / r.height;
        setP({ x: Math.max(-1, Math.min(1, x * 2)), y: Math.max(-1, Math.min(1, y * 2)) });
      });
    };
    const onLeave = () => setP({ x: 0, y: 0 });
    el.addEventListener('mousemove', onMove);
    el.addEventListener('mouseleave', onLeave);
    return () => {
      el.removeEventListener('mousemove', onMove);
      el.removeEventListener('mouseleave', onLeave);
      cancelAnimationFrame(raf);
    };
  }, []);
  return [ref, p] as const;
}

// Small inline SVG icon set — kept simple, line-based.
type IconProps = React.SVGProps<SVGSVGElement>;
const Icon: Record<string, (p?: IconProps) => JSX.Element> = {
  Arrow: (p) => (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M3 8h10M9 4l4 4-4 4" />
    </svg>
  ),
  ArrowSm: (p) => (
    <svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M2.5 6h7M6.5 3l3 3-3 3" />
    </svg>
  ),
  Check: (p) => (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M3 8.5l3.2 3L13 4.5" />
    </svg>
  ),
  X: (p) => (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  ),
  Plus: (p) => (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" {...p}>
      <path d="M8 3v10M3 8h10" />
    </svg>
  ),
  Minus: (p) => (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" {...p}>
      <path d="M3 8h10" />
    </svg>
  ),
  Mail: (p) => (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <rect x="2" y="3.5" width="12" height="9" rx="1.5"/><path d="M2.5 4.5l5.5 4.5 5.5-4.5"/>
    </svg>
  ),
  LinkedIn: (p) => (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" {...p}>
      <path d="M3.5 6h2v7h-2zM4.5 3a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4zM7 6h1.9v1h.03c.27-.5.93-1.03 1.92-1.03 2.05 0 2.43 1.35 2.43 3.1V13h-2V9.55c0-.82-.02-1.88-1.15-1.88-1.15 0-1.33.9-1.33 1.82V13h-2V6z"/>
    </svg>
  ),
  Bolt: (p) => (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" {...p}>
      <path d="M9 2L3 9h4l-1 5 6-7H8z" />
    </svg>
  ),
  Chart: (p) => (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M2 13h12M4 11V8M7 11V5M10 11V7M13 11V3"/>
    </svg>
  ),
  Plug: (p) => (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M6 2v3M10 2v3M4 5h8v3a4 4 0 0 1-8 0V5zM8 12v2"/>
    </svg>
  ),
  Factory: (p) => (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M2 13V7l3 2V7l3 2V7l3 2V4l3 1v8H2zM4 11h1M7 11h1M10 11h1"/>
    </svg>
  ),
  Truck: (p) => (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M1 4h9v7H1zM10 7h3l2 2v2h-5zM4.5 12.5a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4zM12 12.5a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4z"/>
    </svg>
  ),
  Bot: (p) => (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <rect x="3" y="5" width="10" height="8" rx="2"/><path d="M8 2v3M6 9v1M10 9v1M3 9h-1M14 9h-1"/>
    </svg>
  ),
  Refresh: (p) => (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M14 8a6 6 0 1 1-2-4.5M14 2v3.5h-3.5"/>
    </svg>
  ),
};

/* ===== Nav (Block 2) ===== */

function Nav() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 80);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const items = [
    { label: 'Solution', href: '#solution' },
    { label: 'Projects', href: '#projects' },
    { label: 'Store',    href: '/store' },
    { label: 'Why us',   href: '#why' },
    { label: 'Founder',  href: '#founder' },
    { label: 'FAQs',     href: '#faqs' },
  ];

  return (
    <header className={`nav ${scrolled ? 'nav-scrolled' : ''}`}>
      <div className="nav-shell">
        <a href="#top" className="nav-brand" aria-label="KYVERIQX home">
          <span className="nav-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 19V5M5 12l8-7M5 12l8 7M13 5h6M13 19h6" />
            </svg>
          </span>
          <span className="nav-word">KYVERIQX</span>
        </a>
        <nav className="nav-links" aria-label="Primary">
          {items.map((it) => (
            <a key={it.href} href={it.href} className="nav-link">{it.label}</a>
          ))}
        </nav>
        <a href="#book" className="nav-cta btn btn-primary">
          Book audit <Icon.ArrowSm className="arrow" />
        </a>
      </div>
      <style dangerouslySetInnerHTML={{ __html: `
        .nav {
          position: fixed;
          top: 20px;
          left: 0; right: 0;
          z-index: 50;
          display: flex; justify-content: center;
          padding: 0 24px;
          pointer-events: none;
          transition: top .4s var(--ease);
        }
        .nav-shell {
          pointer-events: auto;
          display: flex; align-items: center; gap: 18px;
          width: 100%;
          max-width: 1080px;
          padding: 10px 10px 10px 18px;
          background: rgba(13, 27, 42, 0.55);
          backdrop-filter: saturate(150%) blur(14px);
          -webkit-backdrop-filter: saturate(150%) blur(14px);
          border: 1px solid rgba(255,255,255,0.07);
          border-radius: 999px;
          transition: max-width .5s var(--ease), padding .5s var(--ease), background .4s var(--ease), border-color .4s var(--ease), box-shadow .4s var(--ease);
        }
        .nav-scrolled .nav-shell {
          max-width: 760px;
          background: rgba(10, 20, 34, 0.78);
          border-color: rgba(255,255,255,0.10);
          box-shadow: 0 20px 60px -30px rgba(0,0,0,0.7), 0 0 0 1px rgba(46,168,255,0.08) inset;
        }
        .nav-brand {
          display: inline-flex; align-items: center; gap: 10px;
          font-weight: 600;
          letter-spacing: 0.04em;
          font-size: 14px;
          color: var(--ink-100);
        }
        .nav-mark {
          width: 30px; height: 30px;
          display: inline-grid; place-items: center;
          border-radius: 9px;
          background: linear-gradient(135deg, var(--blue-500), var(--blue-400));
          color: #07111F;
          box-shadow: 0 0 24px -4px rgba(46,168,255,0.55);
        }
        .nav-word {
          font-feature-settings: "tnum";
        }
        .nav-links {
          display: flex; align-items: center; gap: 4px;
          margin-left: auto;
          margin-right: 6px;
        }
        .nav-link {
          padding: 8px 14px;
          font-size: 14px;
          color: var(--ink-300);
          border-radius: 999px;
          white-space: nowrap;
          transition: color .25s var(--ease), background .25s var(--ease);
        }
        .nav-link:hover {
          color: var(--ink-100);
          background: rgba(255,255,255,0.04);
        }
        .nav-cta {
          padding: 10px 16px;
          font-size: 13.5px;
        }
        @media (max-width: 880px) {
          .nav-links { display: none; }
          .nav-shell { max-width: 480px; }
          .nav-scrolled .nav-shell { max-width: 420px; }
        }
      ` }} />
    </header>
  );
}

/* ===== DashboardMock (Block 3) ===== */

function DashboardMock({ tilt }: { tilt: { x: number; y: number } }) {
  // tick state — small fluctuations to feel "live"
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1800);
    return () => clearInterval(id);
  }, []);

  // small deterministic noise per tick
  const wobble = (seed: number) => {
    const s = Math.sin((tick + seed) * 12.9898) * 43758.5453;
    return (s - Math.floor(s)) - 0.5;
  };

  const revenue = 4.82 + wobble(1) * 0.08;
  const orders = 1284 + Math.round(wobble(2) * 6);
  const ontime = (96.4 + wobble(3) * 0.3).toFixed(1);

  // sparkline points
  const spark = useMemo(() => {
    const pts: number[] = [];
    let v = 40;
    for (let i = 0; i < 28; i++) {
      v += (Math.sin(i * 0.6 + tick * 0.7) * 3) + (Math.random() * 2 - 1);
      v = Math.max(20, Math.min(80, v));
      pts.push(v);
    }
    return pts;
  }, [tick]);

  const w = 260, h = 70;
  const stepX = w / (spark.length - 1);
  const sparkPath = spark.map((y, i) => `${i ? 'L' : 'M'}${(i * stepX).toFixed(1)},${(h - y * 0.7).toFixed(1)}`).join(' ');
  const sparkArea = `${sparkPath} L${w},${h} L0,${h} Z`;

  // flow nodes pulse
  const pulse = (tick % 3);

  return (
    <div
      className="dash"
      style={{
        transform: `perspective(1400px) rotateX(${(-tilt.y * 2.2).toFixed(2)}deg) rotateY(${(tilt.x * 3.2).toFixed(2)}deg)`,
      }}
    >
      {/* glow halo */}
      <div className="dash-halo" aria-hidden="true" />

      <div className="dash-frame">
        {/* header */}
        <div className="dash-header">
          <div className="dash-traffic">
            <span /><span /><span />
          </div>
          <div className="dash-tabs">
            <span className="tab active">Operations</span>
            <span className="tab">Sales</span>
            <span className="tab">Production</span>
          </div>
          <div className="dash-status">
            <span className="status-dot" />
            <span className="mono" style={{ fontSize: 11, color: 'var(--ink-300)' }}>LIVE · 02:34s</span>
          </div>
        </div>

        {/* body */}
        <div className="dash-body">
          {/* KPI row */}
          <div className="kpi-row">
            <div className="kpi">
              <div className="kpi-label">Net Revenue (CR)</div>
              <div className="kpi-value">
                ₹{revenue.toFixed(2)}
                <span className="kpi-delta up">+8.4%</span>
              </div>
              <svg className="kpi-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
                <defs>
                  <linearGradient id="sg" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="#00C2FF" stopOpacity="0.35" />
                    <stop offset="100%" stopColor="#00C2FF" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <path d={sparkArea} fill="url(#sg)" />
                <path d={sparkPath} fill="none" stroke="#00C2FF" strokeWidth="1.5" />
              </svg>
            </div>
            <div className="kpi">
              <div className="kpi-label">Orders today</div>
              <div className="kpi-value">{orders.toLocaleString()}</div>
              <div className="kpi-bars">
                {[42, 60, 38, 72, 55, 81, 64].map((v, i) => (
                  <span key={i} style={{ height: `${v}%` }} />
                ))}
              </div>
            </div>
            <div className="kpi">
              <div className="kpi-label">On-time dispatch</div>
              <div className="kpi-value">
                {ontime}<span style={{ color: 'var(--ink-400)', fontSize: 14, fontWeight: 500 }}>%</span>
              </div>
              <div className="kpi-ring">
                <svg viewBox="0 0 60 60" width="60" height="60">
                  <circle cx="30" cy="30" r="24" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="5" />
                  <circle
                    cx="30" cy="30" r="24"
                    fill="none" stroke="url(#rg)" strokeWidth="5" strokeLinecap="round"
                    strokeDasharray={`${(parseFloat(ontime) / 100) * 150.8} 200`}
                    transform="rotate(-90 30 30)"
                  />
                  <defs>
                    <linearGradient id="rg" x1="0" x2="1">
                      <stop offset="0%" stopColor="#2EA8FF" />
                      <stop offset="100%" stopColor="#00C2FF" />
                    </linearGradient>
                  </defs>
                </svg>
              </div>
            </div>
          </div>

          {/* split: workflow + alerts */}
          <div className="dash-split">
            <div className="panel flow">
              <div className="panel-head">
                <span className="panel-title">Workflow · Freight RFQ Agent</span>
                <span className="chip mini"><span className="dot" />Running</span>
              </div>
              <div className="flow-grid">
                {[
                  { l: 'Trigger', s: 'PO Created' },
                  { l: 'AI Agent', s: 'Push RFQ → 218 carriers' },
                  { l: 'Action', s: 'Negotiate · lock bid' },
                  { l: 'Output', s: 'Update ERP + notify' },
                ].map((n, i) => (
                  <Fragment key={i}>
                    <div className={`flow-node ${pulse === i % 3 ? 'pulse' : ''}`}>
                      <div className="flow-node-l">{n.l}</div>
                      <div className="flow-node-s">{n.s}</div>
                    </div>
                    {i < 3 && (
                      <div className="flow-arrow" aria-hidden="true">
                        <svg viewBox="0 0 24 8" width="24" height="8">
                          <path d="M0 4h20M16 1l4 3-4 3" fill="none" stroke="rgba(46,168,255,0.6)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </div>
                    )}
                  </Fragment>
                ))}
              </div>
            </div>

            <div className="panel alerts">
              <div className="panel-head">
                <span className="panel-title">Exceptions</span>
                <span className="mono" style={{ fontSize: 11, color: 'var(--ink-400)' }}>last 4h</span>
              </div>
              <ul className="alert-list">
                <li>
                  <span className="alert-tag warn">QC</span>
                  <span className="alert-text">Plant 2 · viscosity drift detected</span>
                  <span className="mono alert-time">02:14</span>
                </li>
                <li>
                  <span className="alert-tag info">DSP</span>
                  <span className="alert-text">12 invoices pending GST validation</span>
                  <span className="mono alert-time">01:48</span>
                </li>
                <li>
                  <span className="alert-tag ok">AI</span>
                  <span className="alert-text">38 leads qualified by voice agent</span>
                  <span className="mono alert-time">01:02</span>
                </li>
                <li>
                  <span className="alert-tag warn">FIN</span>
                  <span className="alert-text">Dealer ledger reconciled · 2 holds</span>
                  <span className="mono alert-time">00:31</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        .dash {
          position: relative;
          width: 100%;
          max-width: 640px;
          transform-style: preserve-3d;
          transition: transform .25s var(--ease);
          will-change: transform;
        }
        .dash-halo {
          position: absolute;
          inset: -40px;
          background:
            radial-gradient(60% 50% at 30% 30%, rgba(0,194,255,0.18), transparent 70%),
            radial-gradient(50% 60% at 70% 70%, rgba(46,168,255,0.18), transparent 70%);
          filter: blur(40px);
          z-index: -1;
          pointer-events: none;
        }
        .dash-frame {
          background:
            linear-gradient(180deg, rgba(27, 38, 59, 0.95), rgba(13, 27, 42, 0.98));
          border: 1px solid rgba(255,255,255,0.10);
          border-radius: 18px;
          box-shadow:
            0 1px 0 rgba(255,255,255,0.06) inset,
            0 40px 80px -30px rgba(0,0,0,0.6),
            0 0 0 1px rgba(46,168,255,0.08);
          overflow: hidden;
        }
        .dash-header {
          display: flex; align-items: center; gap: 16px;
          padding: 12px 16px;
          border-bottom: 1px solid var(--line);
          background: rgba(255,255,255,0.02);
        }
        .dash-traffic { display: flex; gap: 6px; }
        .dash-traffic span {
          width: 9px; height: 9px; border-radius: 50%;
          background: rgba(255,255,255,0.12);
        }
        .dash-tabs { display: flex; gap: 4px; margin-left: 6px; }
        .tab {
          padding: 4px 10px;
          font-size: 12px;
          color: var(--ink-400);
          border-radius: 6px;
        }
        .tab.active {
          background: rgba(46,168,255,0.12);
          color: var(--blue-400);
        }
        .dash-status { display: inline-flex; align-items: center; gap: 8px; margin-left: auto; }
        .status-dot {
          width: 7px; height: 7px; border-radius: 50%;
          background: #34D399;
          box-shadow: 0 0 10px #34D399;
          animation: blink 1.6s ease-in-out infinite;
        }
        @keyframes blink {
          0%, 100% { opacity: 1; } 50% { opacity: 0.4; }
        }

        .dash-body { padding: 16px; display: grid; gap: 14px; }
        .kpi-row { display: grid; grid-template-columns: 1.3fr 1fr 1fr; gap: 12px; }
        .kpi {
          background: rgba(255,255,255,0.025);
          border: 1px solid var(--line);
          border-radius: 12px;
          padding: 12px 14px;
          min-height: 110px;
          display: flex; flex-direction: column; gap: 8px;
          position: relative;
          overflow: hidden;
        }
        .kpi-label {
          font-size: 11px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--ink-400);
        }
        .kpi-value {
          font-size: 22px;
          font-weight: 600;
          letter-spacing: -0.015em;
          font-variant-numeric: tabular-nums;
          display: inline-flex; align-items: baseline; gap: 8px;
        }
        .kpi-delta {
          font-size: 11px;
          font-weight: 500;
          padding: 2px 6px;
          border-radius: 4px;
        }
        .kpi-delta.up {
          color: #34D399;
          background: rgba(52, 211, 153, 0.12);
        }
        .kpi-spark { width: 100%; height: 40px; margin-top: auto; }
        .kpi-bars {
          display: flex; align-items: flex-end; gap: 4px;
          height: 40px;
          margin-top: auto;
        }
        .kpi-bars span {
          flex: 1; min-height: 4px;
          background: linear-gradient(180deg, #2EA8FF, #1E8FE0);
          border-radius: 2px;
          opacity: 0.85;
        }
        .kpi-ring { margin-top: auto; align-self: flex-end; }

        .dash-split { display: grid; grid-template-columns: 1.5fr 1fr; gap: 12px; }
        .panel {
          background: rgba(255,255,255,0.025);
          border: 1px solid var(--line);
          border-radius: 12px;
          padding: 12px;
        }
        .panel-head {
          display: flex; align-items: center; justify-content: space-between;
          margin-bottom: 10px;
        }
        .panel-title {
          font-size: 12px;
          font-weight: 500;
          color: var(--ink-200);
          letter-spacing: -0.005em;
        }
        .chip.mini {
          font-size: 10.5px;
          padding: 3px 8px;
        }

        .flow-grid {
          display: grid;
          grid-template-columns: 1fr auto 1fr;
          grid-template-rows: auto auto;
          gap: 6px 6px;
          align-items: center;
        }
        .flow-node {
          background: linear-gradient(180deg, rgba(46,168,255,0.07), rgba(46,168,255,0.02));
          border: 1px solid rgba(46,168,255,0.18);
          border-radius: 8px;
          padding: 8px 10px;
          transition: box-shadow .35s var(--ease), border-color .35s var(--ease);
        }
        .flow-node.pulse {
          border-color: rgba(0,194,255,0.55);
          box-shadow: 0 0 0 1px rgba(0,194,255,0.4), 0 0 20px -2px rgba(0,194,255,0.45);
        }
        .flow-node-l {
          font-size: 10px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--blue-400);
        }
        .flow-node-s {
          font-size: 11.5px;
          color: var(--ink-200);
          margin-top: 2px;
        }
        .flow-arrow { display: grid; place-items: center; }

        .alert-list {
          list-style: none; padding: 0; margin: 0;
          display: grid; gap: 6px;
        }
        .alert-list li {
          display: grid;
          grid-template-columns: auto 1fr auto;
          gap: 8px;
          align-items: center;
          font-size: 11.5px;
          color: var(--ink-200);
          padding: 6px 4px;
          border-top: 1px dashed var(--line);
        }
        .alert-list li:first-child { border-top: 0; }
        .alert-tag {
          font-size: 9.5px;
          font-weight: 600;
          letter-spacing: 0.08em;
          padding: 2px 5px;
          border-radius: 3px;
        }
        .alert-tag.warn { color: #FBBF24; background: rgba(251,191,36,0.12); }
        .alert-tag.info { color: var(--blue-400); background: rgba(0,194,255,0.12); }
        .alert-tag.ok   { color: #34D399; background: rgba(52,211,153,0.12); }
        .alert-text { color: var(--ink-200); }
        .alert-time { color: var(--ink-500); font-size: 10.5px; }

        @media (max-width: 720px) {
          .kpi-row { grid-template-columns: 1fr 1fr; }
          .kpi:nth-child(3) { display: none; }
          .dash-split { grid-template-columns: 1fr; }
          .dash-tabs { display: none; }
        }
      ` }} />
    </div>
  );
}

/* ===== Hero (Block 4) ===== */

function Hero() {
  const [parallaxRef, p] = useMouseParallax();

  return (
    <section className="hero section" id="top" ref={parallaxRef as React.RefObject<HTMLElement>}>
      {/* parallax background layers */}
      <div className="hero-bg" aria-hidden="true">
        <div className="grid-bg" />
        <div
          className="hero-orb hero-orb-1"
          style={{ transform: `translate(${p.x * -30}px, ${p.y * -20}px)` }}
        />
        <div
          className="hero-orb hero-orb-2"
          style={{ transform: `translate(${p.x * 20}px, ${p.y * 15}px)` }}
        />
        <div
          className="hero-streak"
          style={{ transform: `translate(${p.x * 10}px, ${p.y * 6}px)` }}
        />
      </div>

      <div className="container hero-grid">
        <div className="hero-copy">
          <span className="eyebrow">AI-Powered Operational Intelligence</span>
          <h1 className="h-display hero-h">
            Your ERP isn&apos;t broken. <br />
            <span className="hero-h-em">It&apos;s just asleep.</span>
          </h1>
          <p className="body-lg hero-lede">
            We wake it up. With AI automation, real-time dashboards, and intelligent
            workflows that turn your existing systems into a decision-making machine.
            <br />
            <span style={{ color: 'var(--ink-300)' }}>
              No rip-and-replace. No 18-month implementation. Just operations that finally run themselves.
            </span>
          </p>

          <div className="hero-ctas">
            <Magnetic strength={6}>
              <a href="#book" className="btn btn-primary">
                Book a free operations audit <Icon.Arrow className="arrow" />
              </a>
            </Magnetic>
            <Magnetic strength={4}>
              <a href="#solution" className="btn btn-ghost">
                See how it works
              </a>
            </Magnetic>
          </div>

          <div className="hero-trust">
            <div className="trust-line">
              <span className="trust-num"><Counter to={14} suffix="+" /> yrs</span>
              <span className="trust-label">across ERP &amp; ops systems</span>
            </div>
            <div className="trust-divider" />
            <div className="trust-line">
              <span className="trust-num"><Counter to={6} /></span>
              <span className="trust-label">industries: auto · chemical · packaging · agri · distribution · franchise</span>
            </div>
            <div className="trust-divider" />
            <div className="trust-line">
              <span className="trust-num"><Counter to={30} /> days</span>
              <span className="trust-label">to live dashboards. or less.</span>
            </div>
          </div>
        </div>

        <div className="hero-mock">
          <DashboardMock tilt={p} />
        </div>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        .hero {
          padding-top: 160px;
          padding-bottom: 80px;
          overflow: hidden;
        }
        .hero-bg {
          position: absolute; inset: 0;
          pointer-events: none;
          z-index: 0;
        }
        .hero-orb {
          position: absolute;
          border-radius: 50%;
          filter: blur(60px);
          will-change: transform;
          transition: transform .4s var(--ease);
        }
        .hero-orb-1 {
          top: -120px; right: -120px;
          width: 520px; height: 520px;
          background: radial-gradient(circle, rgba(0,194,255,0.30), transparent 65%);
        }
        .hero-orb-2 {
          bottom: -200px; left: -150px;
          width: 600px; height: 600px;
          background: radial-gradient(circle, rgba(46,168,255,0.22), transparent 65%);
        }
        .hero-streak {
          position: absolute;
          top: 30%; left: 40%;
          width: 600px; height: 1px;
          background: linear-gradient(90deg, transparent, rgba(0,194,255,0.4), transparent);
          transform-origin: center;
          rotate: -8deg;
          will-change: transform;
          transition: transform .4s var(--ease);
        }
        .hero-grid {
          display: grid;
          grid-template-columns: 1.05fr 1fr;
          gap: 60px;
          align-items: center;
          z-index: 1;
        }
        .hero-copy { display: grid; gap: 24px; }
        .hero-h { margin: 0; }
        .hero-h-em {
          background: linear-gradient(90deg, #2EA8FF 0%, #00C2FF 60%, #7BDDFF 100%);
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        .hero-lede {
          margin: 0;
          max-width: 580px;
        }
        .hero-ctas {
          display: flex; flex-wrap: wrap; gap: 12px;
          margin-top: 8px;
        }
        .hero-trust {
          display: flex; flex-wrap: wrap; align-items: stretch;
          gap: 18px;
          margin-top: 18px;
          padding-top: 28px;
          border-top: 1px solid var(--line);
        }
        .trust-line {
          display: grid; gap: 4px;
          max-width: 280px;
        }
        .trust-num {
          font-size: 22px;
          font-weight: 600;
          letter-spacing: -0.02em;
          color: var(--ink-100);
          font-variant-numeric: tabular-nums;
        }
        .trust-label {
          font-size: 12.5px;
          line-height: 1.4;
          color: var(--ink-400);
        }
        .trust-divider {
          width: 1px;
          background: var(--line);
          margin: 4px 0;
        }
        .hero-mock {
          display: flex; justify-content: flex-end;
        }

        @media (max-width: 960px) {
          .hero-grid {
            grid-template-columns: 1fr;
            gap: 70px;
          }
          .hero-mock { justify-content: center; }
          .trust-divider { display: none; }
        }
        @media (max-width: 600px) {
          .hero { padding-top: 130px; }
          .hero-trust { flex-direction: column; gap: 12px; }
        }
      ` }} />
    </section>
  );
}

/* ===== Problem & Solution (Block 5) ===== */

function Problem() {
  const ref = useReveal();
  const pains = [
    'Pull reports manually every Monday morning',
    'Chase approvals over phone calls and emails',
    'Discover production issues after the customer complains',
    'Make decisions on data that’s already 3 days old',
    'Reconcile dealer, dispatch, and finance numbers by hand',
  ];
  return (
    <section className="section problem" id="problem" ref={ref as React.RefObject<HTMLElement>}>
      <div className="container">
        <div className="problem-wrap">
          <div className="problem-head reveal">
            <span className="eyebrow">The gap</span>
            <h2 className="h-section problem-h">
              If your business runs on <em>Excel sheets</em>, <em>WhatsApp updates</em>, and <em>&ldquo;let me check with the team,&rdquo;</em><br />
              you&apos;re losing money every single day.
            </h2>
          </div>

          <div className="problem-grid">
            <div className="reveal reveal-delay-1">
              <p className="body-lg" style={{ marginTop: 0 }}>
                You invested lakhs (or crores) in an ERP. But your team still:
              </p>
              <ul className="pain-list">
                {pains.map((p, i) => (
                  <li key={i} className="pain-item">
                    <span className="pain-x" aria-hidden="true">
                      <Icon.X />
                    </span>
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="erp-card reveal reveal-delay-2">
              <div className="erp-stack">
                <div className="erp-tile">
                  <span className="erp-label">Your ERP</span>
                  <span className="erp-stat">stores data</span>
                </div>
                <div className="erp-tile muted">
                  <span className="erp-label">Your ERP</span>
                  <span className="erp-stat strike">thinks</span>
                </div>
                <div className="erp-tile muted">
                  <span className="erp-label">Your ERP</span>
                  <span className="erp-stat strike">alerts</span>
                </div>
                <div className="erp-tile muted">
                  <span className="erp-label">Your ERP</span>
                  <span className="erp-stat strike">decides</span>
                </div>
              </div>
              <p className="erp-caption">
                That gap is what <strong>KYVERIQX</strong> was built to close.
              </p>
            </div>
          </div>
        </div>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        .problem-h em {
          font-style: normal;
          background: linear-gradient(90deg, #2EA8FF, #00C2FF);
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
          font-weight: 600;
        }
        .problem-head { display: grid; gap: 14px; margin-bottom: 56px; max-width: 980px; }
        .problem-grid {
          display: grid;
          grid-template-columns: 1.2fr 1fr;
          gap: 60px;
          align-items: start;
        }
        .pain-list {
          list-style: none; padding: 0; margin: 24px 0 0 0;
          display: grid; gap: 14px;
        }
        .pain-item {
          display: grid;
          grid-template-columns: 24px 1fr;
          gap: 14px;
          align-items: center;
          font-size: 16.5px;
          line-height: 1.5;
          color: var(--ink-200);
          padding: 14px 0;
          border-top: 1px solid var(--line);
        }
        .pain-item:first-child { border-top: 1px solid var(--line); }
        .pain-x {
          width: 24px; height: 24px;
          display: grid; place-items: center;
          border-radius: 6px;
          background: rgba(255,90,90,0.10);
          color: #FF8B8B;
        }

        .erp-card {
          background: linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01));
          border: 1px solid var(--line);
          border-radius: 22px;
          padding: 28px;
        }
        .erp-stack { display: grid; gap: 10px; }
        .erp-tile {
          display: flex; align-items: center; justify-content: space-between;
          padding: 14px 18px;
          background: rgba(46,168,255,0.06);
          border: 1px solid rgba(46,168,255,0.18);
          border-radius: 12px;
        }
        .erp-tile.muted {
          background: rgba(255,255,255,0.02);
          border-color: var(--line);
        }
        .erp-label {
          font-size: 11.5px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--ink-400);
        }
        .erp-stat {
          font-size: 17px;
          font-weight: 600;
          color: var(--blue-400);
          letter-spacing: -0.01em;
        }
        .erp-stat.strike {
          color: var(--ink-500);
          text-decoration: line-through;
          text-decoration-color: rgba(255,90,90,0.4);
          text-decoration-thickness: 1.5px;
        }
        .erp-caption {
          font-size: 15px;
          color: var(--ink-200);
          margin: 22px 0 0 0;
          padding-top: 22px;
          border-top: 1px dashed var(--line);
        }
        .erp-caption strong {
          color: var(--ink-100);
          letter-spacing: 0.02em;
        }

        @media (max-width: 880px) {
          .problem-grid { grid-template-columns: 1fr; gap: 40px; }
        }
      ` }} />
    </section>
  );
}

function Solution() {
  const ref = useReveal();
  const caps: Array<{
    icon: JSX.Element;
    title: string;
    body: string;
    tag: string;
    systems?: string[];
  }> = [
    {
      icon: <Icon.Refresh />,
      title: 'AI Workflow Automation',
      body: 'Approvals, follow-ups, reports, escalations — all automated. Your team stops doing robot work and starts doing thinking work.',
      tag: '01',
    },
    {
      icon: <Icon.Chart />,
      title: 'Executive & MIS Dashboards',
      body: 'One screen. Live numbers. Sales, production, dispatch, collections, margins — all updating in real time. Built for CEOs who hate surprises.',
      tag: '02',
    },
    {
      icon: <Icon.Plug />,
      title: 'ERP Intelligence Layer',
      body: 'Integrates with Microsoft Business Central, SAP, Oracle, Tally, Zoho, or your custom ERP — then adds the analytics, alerts, and automations it was missing.',
      tag: '03',
      systems: ['Business Central', 'SAP', 'Oracle', 'Tally', 'Zoho', 'Custom'],
    },
    {
      icon: <Icon.Factory />,
      title: 'Manufacturing Intelligence',
      body: 'Live production tracking, QC dashboards, machine monitoring, exception alerts. Catch problems on the shop floor, not in the monthly review.',
      tag: '04',
    },
    {
      icon: <Icon.Truck />,
      title: 'Logistics & Distribution',
      body: 'Transport bidding platforms, dealer portals, shipment tracking, vendor management. Every link in the chain, visible and controllable.',
      tag: '05',
    },
    {
      icon: <Icon.Bot />,
      title: 'AI Sales & Outreach Agents',
      body: 'Voice agents that call, qualify, and follow up 24/7. Personalized cold email at scale. CRM automation that tells your team exactly who to call today.',
      tag: '06',
    },
  ];

  return (
    <section className="section solution" id="solution" ref={ref as React.RefObject<HTMLElement>}>
      <div className="container">
        <div className="section-head reveal">
          <span className="eyebrow">The solution</span>
          <h2 className="h-section">
            We don&apos;t replace your ERP. <br />
            <span style={{ color: 'var(--ink-300)' }}>We make it intelligent.</span>
          </h2>
          <p className="body-lg" style={{ maxWidth: 760 }}>
            KYVERIQX layers AI automation, real-time intelligence, and connected workflows
            <em style={{ fontStyle: 'normal', color: 'var(--blue-400)' }}> on top </em>
            of the systems you already use. So every department finally talks to every other department —
            and every decision has live data behind it.
          </p>
        </div>

        <div className="cap-grid">
          {caps.map((c, i) => (
            <div className={`cap card card-hover reveal reveal-delay-${(i % 3) + 1}`} key={c.tag}>
              <div className="cap-head">
                <span className="cap-icon">{c.icon}</span>
                <span className="cap-tag mono">{c.tag}</span>
              </div>
              <h3 className="h-card cap-title">{c.title}</h3>
              <p className="body-md cap-body">{c.body}</p>
              {c.systems && (
                <div className="cap-systems">
                  {c.systems.map((s) => (
                    <span key={s} className="chip">{s}</span>
                  ))}
                </div>
              )}
              <div className="cap-glow" aria-hidden="true" />
            </div>
          ))}
        </div>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        .cap-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 16px;
        }
        .cap {
          padding: 28px 26px 26px;
          display: flex; flex-direction: column; gap: 14px;
          min-height: 270px;
        }
        .cap-head {
          display: flex; align-items: center; justify-content: space-between;
        }
        .cap-icon {
          width: 40px; height: 40px;
          display: grid; place-items: center;
          border-radius: 10px;
          background: linear-gradient(135deg, rgba(46,168,255,0.15), rgba(0,194,255,0.06));
          border: 1px solid rgba(46,168,255,0.22);
          color: var(--blue-400);
        }
        .cap-tag {
          font-size: 12px;
          color: var(--ink-500);
          letter-spacing: 0.05em;
        }
        .cap-title {
          margin: 6px 0 0 0;
          color: var(--ink-100);
        }
        .cap-body { margin: 0; }
        .cap-systems {
          display: flex; flex-wrap: wrap; gap: 6px;
          margin-top: auto;
        }
        .cap-systems .chip {
          font-size: 11.5px;
          padding: 4px 10px;
        }
        .cap-glow {
          position: absolute;
          inset: auto -30% -60% auto;
          width: 240px; height: 240px;
          background: radial-gradient(circle, rgba(0,194,255,0.10), transparent 70%);
          filter: blur(20px);
          opacity: 0;
          transition: opacity .4s var(--ease);
          pointer-events: none;
        }
        .cap:hover .cap-glow { opacity: 1; }

        @media (max-width: 980px) {
          .cap-grid { grid-template-columns: repeat(2, 1fr); }
        }
        @media (max-width: 620px) {
          .cap-grid { grid-template-columns: 1fr; }
        }
      ` }} />
    </section>
  );
}

/* ===== Projects (Block 6) ===== */

function Projects() {
  const ref = useReveal();
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onScroll = () => {
      const max = el.scrollWidth - el.clientWidth;
      setProgress(max > 0 ? el.scrollLeft / max : 0);
    };
    onScroll();
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  const scrollBy = (dir: number) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * (el.clientWidth * 0.7), behavior: 'smooth' });
  };

  type ProjectStat = { v: number | string; suffix: string; label: string; decimals?: number };
  const projects: Array<{
    n: string;
    icon: JSX.Element;
    title: string;
    industry: string;
    scale: string;
    blurb: string;
    stats: ProjectStat[];
    accent: string;
  }> = [
    {
      n: '01',
      icon: <Icon.Factory />,
      title: 'Production Intelligence Platform',
      industry: 'Chemical Manufacturing',
      scale: '400+ Cr revenue client',
      blurb: 'Real-time production tracking & QC dashboard for a multi-plant manufacturer. Replaced 14 daily Excel reports with a single live MIS.',
      stats: [
        { v: 38, suffix: '%', label: 'less reporting time' },
        { v: 14, suffix: '→1', label: 'Excel reports collapsed' },
      ],
      accent: 'Live MIS',
    },
    {
      n: '02',
      icon: <Icon.Truck />,
      title: 'AI Transport Bidding Agent',
      industry: 'Automobile Supply Chain',
      scale: 'Pan-India operations',
      blurb: 'AI agent runs the entire freight bidding cycle — RFQs to 200+ verified transporters, negotiation, bid lock — without a single phone call.',
      stats: [
        { v: 22, suffix: '%', label: 'lower freight costs' },
        { v: 5, suffix: '→0', label: 'people in the loop' },
      ],
      accent: 'AI Agent',
    },
    {
      n: '03',
      icon: <Icon.Chart />,
      title: 'CEO Command-Center Dashboard',
      industry: 'Plastic Packaging',
      scale: 'Multi-plant operations',
      blurb: 'Unified sales, production, dispatch, collections, and inventory into one executive dashboard with AI-powered insights and anomaly alerts.',
      stats: [
        { v: 4, suffix: 'h→25m', label: 'monthly review time' },
        { v: 1, suffix: '', label: 'screen for the CEO' },
      ],
      accent: 'Executive',
    },
    {
      n: '04',
      icon: <Icon.Plug />,
      title: 'Dealer · Customer · Vendor Portal',
      industry: 'Packaging Industry',
      scale: '800+ channel partners',
      blurb: 'Unified self-service portal — orders, shipments, invoices, ledger statements, claims. Finance team finally stopped chasing PDFs.',
      stats: [
        { v: 60, suffix: '%', label: 'fewer support calls' },
        { v: 3, suffix: '×', label: 'faster order processing' },
      ],
      accent: 'Self-Serve',
    },
    {
      n: '05',
      icon: <Icon.Bot />,
      title: 'AI Voice Calling Agent',
      industry: 'B2B Services',
      scale: 'Inbound + outbound funnel',
      blurb: 'Voice agent calls inbound leads in under 60 seconds, qualifies them in natural conversation, books meetings, logs to CRM.',
      stats: [
        { v: 4, suffix: '×', label: 'faster lead response' },
        { v: 2.4, suffix: '×', label: 'qualified meetings booked', decimals: 1 },
      ],
      accent: 'Voice AI',
    },
    {
      n: '06',
      icon: <Icon.Bolt />,
      title: 'AI Cold Email Outreach Engine',
      industry: 'Agriculture',
      scale: 'B2B outbound sales',
      blurb: 'Researches each prospect, writes personalized first-touches, runs multi-step sequences, routes warm replies straight to sales.',
      stats: [
        { v: 18, suffix: '%', label: 'cold reply rate' },
        { v: 40, suffix: '+', label: 'qualified convos / mo' },
      ],
      accent: 'Outbound',
    },
  ];

  return (
    <section className="section projects" id="projects" ref={ref as React.RefObject<HTMLElement>}>
      <div className="container projects-head-wrap">
        <div className="section-head reveal">
          <span className="eyebrow">Selected work</span>
          <h2 className="h-section">
            Real systems. Real businesses. <br />
            <span style={{ color: 'var(--ink-300)' }}>Real numbers.</span>
          </h2>
        </div>

        <div className="projects-controls reveal reveal-delay-1">
          <div className="scroll-bar">
            <div className="scroll-fill" style={{ width: `${Math.max(8, progress * 100)}%` }} />
          </div>
          <div className="scroll-btns">
            <button className="round-btn" aria-label="Previous" onClick={() => scrollBy(-1)}>
              <Icon.ArrowSm style={{ transform: 'rotate(180deg)' }} />
            </button>
            <button className="round-btn" aria-label="Next" onClick={() => scrollBy(1)}>
              <Icon.ArrowSm />
            </button>
          </div>
        </div>
      </div>

      <div className="projects-track-wrap reveal reveal-delay-2">
        <div className="projects-track" ref={scrollerRef}>
          <div className="track-pad-left" />
          {projects.map((p) => (
            <article className="project-card" key={p.n}>
              <header className="proj-head">
                <span className="proj-icon">{p.icon}</span>
                <span className="proj-n mono">PROJECT {p.n}</span>
                <span className="proj-accent">{p.accent}</span>
              </header>

              <div className="proj-meta">
                <span className="proj-industry">{p.industry}</span>
                <span className="proj-dot">·</span>
                <span className="proj-scale">{p.scale}</span>
              </div>

              <h3 className="proj-title">{p.title}</h3>
              <p className="proj-blurb body-md">{p.blurb}</p>

              <div className="proj-stats">
                {p.stats.map((s, i) => (
                  <div className="proj-stat" key={i}>
                    <div className="proj-stat-v">
                      {typeof s.v === 'number' && !s.suffix.includes('→') ? (
                        <Counter to={s.v} suffix={s.suffix} decimals={s.decimals || 0} />
                      ) : (
                        <span className="numeral">{s.v}{s.suffix}</span>
                      )}
                    </div>
                    <div className="proj-stat-l">{s.label}</div>
                  </div>
                ))}
              </div>

              <div className="proj-corner" aria-hidden="true" />
            </article>
          ))}
          <div className="track-pad-right" />
        </div>
        <div className="track-edge track-edge-left" aria-hidden="true" />
        <div className="track-edge track-edge-right" aria-hidden="true" />
      </div>

      <div className="container projects-cta reveal">
        <Magnetic strength={6}>
          <a href="#book" className="btn btn-primary">
            Want results like these for your business? Let&apos;s talk <Icon.Arrow className="arrow" />
          </a>
        </Magnetic>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        .projects-head-wrap {
          display: flex; align-items: flex-end; justify-content: space-between;
          gap: 40px; margin-bottom: 40px;
        }
        .projects-head-wrap .section-head { margin-bottom: 0; }
        .projects-controls {
          display: flex; align-items: center; gap: 18px;
          min-width: 280px;
        }
        .scroll-bar {
          flex: 1;
          height: 2px;
          background: var(--line);
          border-radius: 999px;
          overflow: hidden;
        }
        .scroll-fill {
          height: 100%;
          background: linear-gradient(90deg, var(--blue-500), var(--blue-400));
          transition: width .15s linear;
        }
        .scroll-btns { display: flex; gap: 8px; }
        .round-btn {
          width: 40px; height: 40px;
          display: grid; place-items: center;
          border-radius: 999px;
          background: rgba(255,255,255,0.04);
          border: 1px solid var(--line);
          color: var(--ink-200);
          transition: background .25s var(--ease), border-color .25s var(--ease), transform .2s var(--ease);
        }
        .round-btn:hover {
          background: rgba(46,168,255,0.12);
          border-color: rgba(46,168,255,0.32);
          color: var(--blue-400);
        }
        .round-btn:active { transform: scale(0.95); }

        .projects-track-wrap { position: relative; }
        .projects-track {
          display: flex;
          gap: 20px;
          overflow-x: auto;
          overflow-y: hidden;
          padding: 8px 0 30px;
          scroll-snap-type: x mandatory;
          scrollbar-width: thin;
        }
        .track-pad-left, .track-pad-right { flex: 0 0 calc((100vw - var(--content-w)) / 2 + 24px); min-width: 24px; }
        .track-edge {
          position: absolute; top: 0; bottom: 0;
          width: 80px;
          pointer-events: none;
          z-index: 2;
        }
        .track-edge-left  { left: 0;  background: linear-gradient(90deg, var(--navy-900), transparent); }
        .track-edge-right { right: 0; background: linear-gradient(-90deg, var(--navy-900), transparent); }

        .project-card {
          flex: 0 0 420px;
          min-height: 360px;
          padding: 28px;
          background:
            linear-gradient(180deg, rgba(46,168,255,0.04), rgba(255,255,255,0.01));
          border: 1px solid var(--line);
          border-radius: 20px;
          display: flex; flex-direction: column; gap: 14px;
          scroll-snap-align: start;
          transition: transform .35s var(--ease), border-color .35s var(--ease), box-shadow .35s var(--ease);
          position: relative;
          overflow: hidden;
        }
        .project-card:hover {
          transform: translateY(-6px);
          border-color: rgba(46,168,255,0.30);
          box-shadow: 0 30px 70px -30px rgba(0,194,255,0.30);
        }
        .proj-head {
          display: flex; align-items: center; gap: 12px;
        }
        .proj-icon {
          width: 36px; height: 36px;
          display: grid; place-items: center;
          border-radius: 9px;
          background: rgba(46,168,255,0.12);
          color: var(--blue-400);
          border: 1px solid rgba(46,168,255,0.20);
        }
        .proj-n {
          font-size: 11px;
          color: var(--ink-500);
          letter-spacing: 0.12em;
        }
        .proj-accent {
          margin-left: auto;
          font-size: 11px;
          font-weight: 500;
          letter-spacing: 0.05em;
          padding: 4px 10px;
          border-radius: 999px;
          color: var(--blue-400);
          background: rgba(0,194,255,0.10);
          border: 1px solid rgba(0,194,255,0.25);
        }
        .proj-meta {
          display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
          font-size: 12.5px;
          color: var(--ink-400);
        }
        .proj-dot { opacity: 0.5; }
        .proj-title {
          margin: 4px 0 0 0;
          font-size: 23px;
          line-height: 1.2;
          letter-spacing: -0.015em;
          font-weight: 600;
          color: var(--ink-100);
          text-wrap: balance;
        }
        .proj-blurb { margin: 0; }
        .proj-stats {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
          margin-top: auto;
          padding-top: 18px;
          border-top: 1px dashed var(--line);
        }
        .proj-stat {
          display: grid; gap: 4px;
        }
        .proj-stat-v {
          font-size: 28px;
          font-weight: 600;
          letter-spacing: -0.025em;
          background: linear-gradient(90deg, #2EA8FF, #00C2FF);
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
          font-variant-numeric: tabular-nums;
        }
        .proj-stat-l {
          font-size: 12px;
          color: var(--ink-400);
          line-height: 1.35;
        }
        .proj-corner {
          position: absolute;
          right: -60px; bottom: -60px;
          width: 200px; height: 200px;
          background: radial-gradient(circle, rgba(0,194,255,0.10), transparent 65%);
          pointer-events: none;
        }

        .projects-cta {
          display: flex; justify-content: center;
          margin-top: 30px;
        }

        @media (max-width: 720px) {
          .projects-head-wrap { flex-direction: column; align-items: flex-start; gap: 24px; }
          .project-card { flex-basis: 320px; }
          .track-edge { width: 30px; }
        }
      ` }} />
    </section>
  );
}

/* ===== WhyUs (Block 7) ===== */

function WhyUs() {
  const ref = useReveal();
  const rows: Array<[string, string]> = [
    ['Generic AI consultants',           'Deep ERP + operations expertise'],
    ['Tools that don’t talk to each other', 'Integration-first architecture'],
    ['Pretty dashboards with stale data', 'Real-time operational visibility'],
    ['12-month implementations',          'Working systems in weeks'],
    ['“AI strategy” PowerPoints',         'Measurable ROI on every project'],
    ['Software that replaces your team',  'Intelligence that empowers them'],
  ];
  return (
    <section className="section why" id="why" ref={ref as React.RefObject<HTMLElement>}>
      <div className="container">
        <div className="section-head reveal">
          <span className="eyebrow">Why KYVERIQX</span>
          <h2 className="h-section">
            Most AI agencies build demos. <br />
            <span style={{ color: 'var(--blue-400)' }}>We build systems that run your business on Monday morning.</span>
          </h2>
        </div>

        <div className="compare-grid">
          <div className="compare-col col-them reveal reveal-delay-1">
            <div className="compare-head">
              <span className="compare-tag tag-them">Usually</span>
              <span className="compare-title">What you get elsewhere</span>
            </div>
            <ul className="compare-list">
              {rows.map(([them], i) => (
                <li key={i} className="compare-row them">
                  <span className="compare-icon"><Icon.X /></span>
                  <span>{them}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="vs reveal" aria-hidden="true">
            <span className="mono">VS</span>
          </div>

          <div className="compare-col col-us reveal reveal-delay-2">
            <div className="compare-head">
              <span className="compare-tag tag-us">KYVERIQX</span>
              <span className="compare-title us">What you get with us</span>
            </div>
            <ul className="compare-list">
              {rows.map(([, us], i) => (
                <li key={i} className="compare-row us">
                  <span className="compare-icon ok"><Icon.Check /></span>
                  <span>{us}</span>
                </li>
              ))}
            </ul>
            <div className="col-us-glow" aria-hidden="true" />
          </div>
        </div>

        <div className="why-footer reveal">
          <p className="body-lg" style={{ maxWidth: 880, margin: '0 auto', textAlign: 'center' }}>
            We sit at the intersection of{' '}
            <span className="why-tag">ERP systems</span>{' '}·{' '}
            <span className="why-tag">business operations</span>{' '}·{' '}
            <span className="why-tag">AI automation</span>{' '}·{' '}
            <span className="why-tag">data intelligence</span>.
            <br />
            <span style={{ color: 'var(--ink-400)' }}>
              A combination almost no one offers. It&apos;s why our clients stop shopping around once they see a demo.
            </span>
          </p>
        </div>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        .compare-grid {
          display: grid;
          grid-template-columns: 1fr auto 1fr;
          gap: 20px;
          align-items: stretch;
        }
        .compare-col {
          padding: 28px;
          border-radius: 22px;
          border: 1px solid var(--line);
          position: relative;
        }
        .col-them {
          background: linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.005));
          color: var(--ink-400);
        }
        .col-us {
          background:
            linear-gradient(180deg, rgba(46,168,255,0.10), rgba(0,194,255,0.03));
          border-color: rgba(46,168,255,0.30);
          box-shadow: 0 20px 60px -30px rgba(0,194,255,0.30);
          overflow: hidden;
        }
        .col-us-glow {
          position: absolute; inset: -30% -30% auto auto;
          width: 320px; height: 320px;
          background: radial-gradient(circle, rgba(0,194,255,0.18), transparent 70%);
          pointer-events: none;
          filter: blur(20px);
        }
        .compare-head {
          display: flex; align-items: center; gap: 12px;
          margin-bottom: 20px;
        }
        .compare-tag {
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.12em;
          padding: 4px 10px;
          border-radius: 999px;
          text-transform: uppercase;
        }
        .tag-them { background: rgba(255,255,255,0.04); color: var(--ink-400); border: 1px solid var(--line); }
        .tag-us {
          background: linear-gradient(90deg, #2EA8FF, #00C2FF);
          color: #07111F;
        }
        .compare-title {
          font-size: 16px;
          font-weight: 500;
          color: var(--ink-300);
        }
        .compare-title.us { color: var(--ink-100); }
        .compare-list { list-style: none; padding: 0; margin: 0; display: grid; gap: 4px; }
        .compare-row {
          display: grid; grid-template-columns: 22px 1fr; align-items: center;
          gap: 14px;
          font-size: 16px;
          padding: 14px 0;
          border-top: 1px solid var(--line);
        }
        .compare-row.them { color: var(--ink-400); }
        .compare-row.us { color: var(--ink-100); font-weight: 500; }
        .compare-icon {
          width: 22px; height: 22px;
          display: grid; place-items: center;
          border-radius: 6px;
          background: rgba(255,255,255,0.04);
          color: var(--ink-500);
        }
        .compare-icon.ok {
          background: rgba(46,168,255,0.15);
          color: var(--blue-400);
        }

        .vs {
          align-self: center;
          display: grid; place-items: center;
          width: 56px; height: 56px;
          border-radius: 50%;
          background: var(--navy-700);
          border: 1px solid var(--line-strong);
          color: var(--ink-400);
          font-size: 13px;
          letter-spacing: 0.1em;
          box-shadow: 0 10px 30px -15px rgba(0,0,0,0.5);
        }

        .why-footer { margin-top: 50px; }
        .why-tag {
          font-weight: 500;
          color: var(--ink-100);
        }

        @media (max-width: 880px) {
          .compare-grid { grid-template-columns: 1fr; }
          .vs { justify-self: center; margin: -10px 0; }
        }
      ` }} />
    </section>
  );
}

/* ===== Founder (Block 8) ===== */

function Founder() {
  const ref = useReveal();
  return (
    <section className="section founder" id="founder" ref={ref as React.RefObject<HTMLElement>}>
      <div className="container">
        <div className="founder-grid">
          <div className="founder-portrait reveal">
            <div className="portrait-frame">
              <img
                className="portrait-img"
                src="/founder.webp"
                alt="K. Kanth Chandra, founder of KYVERIQX"
              />
              <div className="portrait-grid" aria-hidden="true" />
              <div className="portrait-tint" aria-hidden="true" />
              <div className="portrait-badge">
                <span className="dot" />
                <span className="mono">FOUNDER · KYVERIQX</span>
              </div>
            </div>

            <div className="portrait-card">
              <div className="portrait-card-row">
                <span className="portrait-card-l">Founder &amp; CEO</span>
                <span className="portrait-card-v">K. Kanth Chandra</span>
              </div>
              <div className="portrait-card-row">
                <span className="portrait-card-l">Years in ERP &amp; ops</span>
                <span className="portrait-card-v"><Counter to={14} suffix="+" /></span>
              </div>
              <div className="portrait-card-row">
                <span className="portrait-card-l">Industries</span>
                <span className="portrait-card-v">auto · chemical · packaging · agri · distribution · franchise</span>
              </div>
            </div>
          </div>

          <div className="founder-copy reveal reveal-delay-1">
            <span className="eyebrow">The founder</span>
            <h2 className="h-section founder-h">
              14 years inside ERPs taught me one thing: <br />
              <span style={{ color: 'var(--ink-300)' }}>
                the software isn&apos;t the problem.
              </span>{' '}
              <span className="hero-h-em">The gap around it is.</span>
            </h2>

            <div className="founder-quote">
              <p className="body-lg" style={{ margin: 0 }}>
                I&apos;m <strong>K. Kanth Chandra</strong>, founder of KYVERIQX. For 14+ years
                I&apos;ve worked across <em>automobile, chemical, packaging, agriculture, distribution,
                and franchise network</em> businesses — different industries, different ERP systems,
                different scales. The same operational gaps showed up every time.
              </p>
              <p className="body-md" style={{ marginTop: 18 }}>
                I started KYVERIQX to close those gaps. Not by replacing the systems you&apos;ve
                invested in — but by adding the AI, automation, and intelligence layer that
                finally makes them work the way you thought they would when you bought them.
              </p>
              <p className="body-md" style={{ marginTop: 18, color: 'var(--ink-200)' }}>
                If that sounds like the kind of partner you&apos;ve been looking for, let&apos;s talk.
              </p>
            </div>

            <div className="founder-links">
              <a href="#" className="founder-link">
                <Icon.LinkedIn /> <span>LinkedIn</span>
              </a>
              <a href="mailto:hello@kyveriqx.com" className="founder-link">
                <Icon.Mail /> <span>hello@kyveriqx.com</span>
              </a>
              <a href="#book" className="founder-link link-accent">
                <Icon.Arrow /> <span>Book a call</span>
              </a>
            </div>
          </div>
        </div>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        .founder-grid {
          display: grid;
          grid-template-columns: 300px 1fr;
          gap: 60px;
          align-items: start;
        }
        .founder-portrait { display: grid; gap: 14px; position: sticky; top: 120px; max-width: 300px; }
        .portrait-frame {
          aspect-ratio: 1 / 1.15;
          background:
            linear-gradient(135deg, rgba(46,168,255,0.10), rgba(13,27,42,0.6));
          border: 1px solid rgba(46,168,255,0.25);
          border-radius: 16px;
          position: relative;
          overflow: hidden;
          box-shadow:
            0 30px 80px -40px rgba(0,0,0,0.7),
            0 0 0 1px rgba(46,168,255,0.10) inset;
        }
        .portrait-img {
          position: absolute; inset: 0;
          width: 100%; height: 100%;
          object-fit: cover;
          object-position: center 22%;
          filter: saturate(0.95) contrast(1.02);
        }
        .portrait-tint {
          position: absolute; inset: 0;
          background:
            radial-gradient(120% 80% at 50% 110%, rgba(0,194,255,0.25), transparent 55%),
            linear-gradient(180deg, rgba(13,27,42,0) 50%, rgba(13,27,42,0.55) 100%);
          pointer-events: none;
          mix-blend-mode: screen;
        }
        .portrait-grid {
          position: absolute; inset: 0;
          background-image:
            linear-gradient(rgba(0,194,255,0.07) 1px, transparent 1px),
            linear-gradient(90deg, rgba(0,194,255,0.07) 1px, transparent 1px);
          background-size: 36px 36px;
          mask-image: linear-gradient(180deg, rgba(0,0,0,0.7), transparent 60%);
          -webkit-mask-image: linear-gradient(180deg, rgba(0,0,0,0.7), transparent 60%);
          pointer-events: none;
          mix-blend-mode: screen;
          opacity: 0.6;
        }
        .portrait-badge {
          position: absolute;
          left: 12px; bottom: 12px;
          display: inline-flex; align-items: center; gap: 7px;
          padding: 5px 10px;
          background: rgba(13, 27, 42, 0.7);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          border: 1px solid rgba(255,255,255,0.10);
          border-radius: 999px;
          font-size: 9.5px;
          letter-spacing: 0.12em;
          color: var(--ink-200);
        }

        .portrait-card {
          padding: 14px 16px;
          background: rgba(255,255,255,0.025);
          border: 1px solid var(--line);
          border-radius: 12px;
          display: grid; gap: 8px;
        }
        .portrait-card-row {
          display: grid;
          grid-template-columns: 1fr;
          gap: 4px;
          font-size: 13px;
        }
        .portrait-card-row + .portrait-card-row { padding-top: 8px; border-top: 1px dashed var(--line); }
        .portrait-card-l {
          color: var(--ink-500);
          letter-spacing: 0.08em;
          text-transform: uppercase;
          font-size: 10px;
        }
        .portrait-card-v {
          color: var(--ink-100);
          font-weight: 500;
          font-size: 13px;
          line-height: 1.35;
        }

        .founder-copy { display: grid; gap: 22px; }
        .founder-h { margin: 0; }
        .founder-h .hero-h-em {
          background: linear-gradient(90deg, #2EA8FF, #00C2FF);
          -webkit-background-clip: text; background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        .founder-quote {
          padding: 24px 26px;
          background: linear-gradient(180deg, rgba(255,255,255,0.025), rgba(255,255,255,0.005));
          border-left: 2px solid var(--blue-500);
          border-radius: 4px 14px 14px 4px;
        }
        .founder-quote em {
          color: var(--blue-400);
          font-style: normal;
          font-weight: 500;
        }
        .founder-quote strong { color: var(--ink-100); }
        .founder-links {
          display: flex; flex-wrap: wrap; gap: 8px;
        }
        .founder-link {
          display: inline-flex; align-items: center; gap: 8px;
          padding: 10px 16px;
          font-size: 13.5px;
          color: var(--ink-200);
          background: rgba(255,255,255,0.04);
          border: 1px solid var(--line);
          border-radius: 999px;
          transition: all .25s var(--ease);
        }
        .founder-link:hover {
          color: var(--ink-100);
          border-color: var(--line-strong);
          background: rgba(255,255,255,0.07);
        }
        .founder-link.link-accent {
          color: var(--blue-400);
          border-color: rgba(46,168,255,0.30);
          background: rgba(46,168,255,0.08);
        }
        .founder-link.link-accent:hover {
          background: rgba(46,168,255,0.15);
        }

        @media (max-width: 960px) {
          .founder-grid { grid-template-columns: 1fr; gap: 40px; }
          .founder-portrait { position: static; max-width: 100%; grid-template-columns: 220px 1fr; display: grid; align-items: center; gap: 20px; }
          .portrait-frame { max-width: 220px; }
        }
        @media (max-width: 560px) {
          .founder-portrait { grid-template-columns: 1fr; max-width: 220px; }
        }
      ` }} />
    </section>
  );
}

/* ===== BookCall (Block 9) ===== */

function BookCall() {
  const ref = useReveal();

  useEffect(() => {
    (function (C: any, A: string, L: string) {
      const p = function (a: any, ar: any) { a.q.push(ar); };
      const d = C.document;
      C.Cal = C.Cal || function () {
        const cal = C.Cal; const ar = arguments;
        if (!cal.loaded) { cal.ns = {}; cal.q = cal.q || []; d.head.appendChild(d.createElement("script")).src = A; cal.loaded = true; }
        if (ar[0] === L) { const api = function () { p(api, arguments); }; const namespace = ar[1]; (api as any).q = (api as any).q || []; if(typeof namespace === "string"){cal.ns[namespace] = cal.ns[namespace] || api; p(cal.ns[namespace], ar); p(cal, ["initNamespace", namespace]);} else p(cal, ar); return; }
        p(cal, ar);
      };
    })(window, "https://app.cal.com/embed/embed.js", "init");

    // @ts-expect-error Cal is loaded dynamically by the snippet above
    Cal("init", "30min", { origin: "https://app.cal.com" });
    // @ts-expect-error Cal namespaces created at runtime
    Cal.ns["30min"]("inline", {
      elementOrSelector: "#my-cal-inline-30min",
      config: { layout: "month_view", useSlotsViewOnSmallScreen: "true" },
      calLink: "kyveriqx-cwdfy1/30min",
    });
    // @ts-expect-error Cal namespaces created at runtime
    Cal.ns["30min"]("ui", { hideEventTypeDetails: false, layout: "month_view", theme: "light" });
  }, []);

  return (
    <section className="section book" id="book" ref={ref as React.RefObject<HTMLElement>}>
      <div className="container">
        <div className="book-grid">
          <div className="book-copy reveal">
            <span className="eyebrow">Let&apos;s talk</span>
            <h2 className="h-section book-h">
              Let&apos;s see if we&apos;re a fit. <br />
              <span style={{ color: 'var(--ink-300)' }}>30 minutes. No pitch deck.</span>
            </h2>

            <ul className="book-checklist">
              <li>
                <span className="book-check"><Icon.Check /></span>
                <span>Map your current operational gaps in plain language</span>
              </li>
              <li>
                <span className="book-check"><Icon.Check /></span>
                <span>Show you 2&ndash;3 specific automation opportunities in your business</span>
              </li>
              <li>
                <span className="book-check"><Icon.Check /></span>
                <span>Give you a realistic ROI estimate &mdash; even if you never work with us</span>
              </li>
            </ul>

            <div className="book-fit">
              <div className="fit-block fit-yes">
                <span className="fit-label">Best for</span>
                <p className="body-md" style={{ margin: 0, color: 'var(--ink-200)' }}>
                  Founders, COOs, CEOs, and Ops Heads of manufacturing, distribution, FMCG, pharma, logistics,
                  or trading companies running on ERP systems.
                </p>
              </div>
              <div className="fit-block fit-no">
                <span className="fit-label">Not for</span>
                <p className="body-md" style={{ margin: 0, color: 'var(--ink-400)' }}>
                  Pre-revenue startups, agencies, or businesses looking for &ldquo;AI strategy consulting.&rdquo;
                  <br />
                  <em style={{ color: 'var(--ink-300)', fontStyle: 'normal' }}>We build, we don&apos;t advise.</em>
                </p>
              </div>
            </div>

            <div className="book-email">
              <Icon.Mail />
              <span>Or email directly: </span>
              <a href="mailto:hello@kyveriqx.com">hello@kyveriqx.com</a>
            </div>
          </div>

          <div className="book-embed reveal reveal-delay-2">
            <div className="cal-wrap">
              <div id="my-cal-inline-30min" style={{ width: '100%' }} />
            </div>
          </div>
        </div>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        .book-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 60px;
          align-items: start;
        }
        .book-copy { display: grid; gap: 24px; }
        .book-h { margin: 0; }
        .book-checklist {
          list-style: none; padding: 0; margin: 0;
          display: grid; gap: 12px;
        }
        .book-checklist li {
          display: grid; grid-template-columns: 26px 1fr; gap: 14px;
          align-items: center;
          font-size: 16px;
          color: var(--ink-200);
        }
        .book-check {
          width: 26px; height: 26px;
          display: grid; place-items: center;
          border-radius: 7px;
          background: rgba(46,168,255,0.14);
          color: var(--blue-400);
          border: 1px solid rgba(46,168,255,0.25);
        }
        .book-fit {
          display: grid; grid-template-columns: 1fr 1fr; gap: 16px;
        }
        .fit-block {
          padding: 18px 20px;
          border-radius: 14px;
          border: 1px solid var(--line);
          display: grid; gap: 8px;
        }
        .fit-yes { border-color: rgba(46,168,255,0.22); background: rgba(46,168,255,0.04); }
        .fit-no  { background: rgba(255,255,255,0.02); }
        .fit-label {
          font-size: 11px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--blue-400);
        }
        .fit-no .fit-label { color: var(--ink-500); }
        .book-email {
          display: inline-flex; align-items: center; gap: 8px;
          padding: 12px 16px;
          background: rgba(255,255,255,0.025);
          border: 1px solid var(--line);
          border-radius: 10px;
          color: var(--ink-300);
          font-size: 14px;
          width: fit-content;
        }
        .book-email a { color: var(--blue-400); }
        .book-email a:hover { text-decoration: underline; text-underline-offset: 3px; }

        .book-embed { display: flex; justify-content: stretch; align-items: flex-start; }
        .cal-wrap {
          width: 100%;
          border: 1px solid rgba(180, 195, 215, 0.55);
          border-radius: 20px;
          overflow: hidden;
          box-shadow: 0 20px 50px -20px rgba(0,0,0,0.25);
          background: #edf1f7;
        }

        @media (max-width: 880px) {
          .book-grid { grid-template-columns: 1fr; gap: 40px; }
          .book-fit { grid-template-columns: 1fr; }
        }
      ` }} />
    </section>
  );
}

/* ===== FAQs (Block 10) ===== */

function FAQs() {
  const ref = useReveal();
  const [open, setOpen] = useState<number>(0);

  const faqs = [
    {
      q: 'Will you replace our existing ERP?',
      a: `No. That's the whole point. We layer intelligence, automation, and dashboards on top of your existing Microsoft Business Central, SAP, Oracle, Tally, Zoho, or custom ERP. Your ERP keeps doing what it does. We make it 10× more useful.`,
    },
    {
      q: 'How long does a typical project take?',
      a: `Most dashboards and automation modules go live in 3–6 weeks. Larger systems (full portals, multi-department platforms) take 8–14 weeks. We deliver in working sprints, not 18-month waterfalls.`,
    },
    {
      q: 'What size of business is this for?',
      a: `We work best with mid-size and enterprise companies (₹50 Cr – ₹5,000 Cr revenue range) that already have an ERP, real operational complexity, and a team that's stuck doing manual work the system should be handling.`,
    },
    {
      q: `We don't have a clean data setup. Is that a problem?`,
      a: `No. Almost no one does. Part of what we do in the first phase is clean, structure, and connect your data sources. That's prerequisite work, not a blocker.`,
    },
    {
      q: `How is this different from hiring an AI consultant or BI agency?`,
      a: `Consultants give you strategy. BI agencies give you dashboards. We give you systems that operate your business — combining AI automation, real-time intelligence, and ERP integration into one working ecosystem. One vendor, one accountability line, one outcome.`,
    },
    {
      q: 'What does it cost?',
      a: `Project-based pricing, depending on scope. Smaller automation modules start around ₹X lakhs; full executive dashboards or portal builds range higher. You'll get a fixed quote on the discovery call. No hourly billing surprises.`,
    },
    {
      q: 'Do you offer ongoing support after launch?',
      a: `Yes. Every system we build comes with 90 days of post-launch support included, plus optional retainers for continuous improvement, new automation modules, and dashboard expansion.`,
    },
    {
      q: 'Our industry is unusual. Will this work for us?',
      a: `Probably. We've built systems across automobile, chemical, packaging, agriculture, distribution, and franchise network businesses. The underlying problems — manual work, data silos, slow decisions — look almost identical across industries. The discovery call is where we'll know for sure.`,
    },
  ];

  return (
    <section className="section faqs" id="faqs" ref={ref as React.RefObject<HTMLElement>}>
      <div className="container">
        <div className="section-head reveal">
          <span className="eyebrow">FAQs</span>
          <h2 className="h-section">
            Questions smart operators ask <br />
            <span style={{ color: 'var(--ink-300)' }}>before they book a call.</span>
          </h2>
        </div>

        <div className="faq-list reveal reveal-delay-1">
          {faqs.map((f, i) => (
            <div className={`faq ${open === i ? 'open' : ''}`} key={i}>
              <button
                className="faq-q"
                onClick={() => setOpen(open === i ? -1 : i)}
                aria-expanded={open === i}
              >
                <span className="faq-n mono">{String(i + 1).padStart(2, '0')}</span>
                <span className="faq-q-text">{f.q}</span>
                <span className="faq-toggle">
                  {open === i ? <Icon.Minus /> : <Icon.Plus />}
                </span>
              </button>
              <div className="faq-a-wrap">
                <p className="faq-a body-md">{f.a}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        .faq-list {
          max-width: 920px;
          margin: 0 auto;
          display: grid;
        }
        .faq {
          border-top: 1px solid var(--line);
        }
        .faq:last-child { border-bottom: 1px solid var(--line); }
        .faq-q {
          width: 100%;
          display: grid;
          grid-template-columns: 44px 1fr 28px;
          gap: 16px;
          align-items: center;
          padding: 22px 4px;
          text-align: left;
          color: var(--ink-100);
          transition: color .25s var(--ease);
        }
        .faq-q:hover { color: var(--blue-400); }
        .faq-n {
          color: var(--ink-500);
          font-size: 12px;
          letter-spacing: 0.08em;
        }
        .faq-q-text {
          font-size: 18px;
          font-weight: 500;
          letter-spacing: -0.01em;
        }
        .faq-toggle {
          width: 28px; height: 28px;
          display: grid; place-items: center;
          border-radius: 999px;
          border: 1px solid var(--line);
          color: var(--ink-300);
          transition: all .25s var(--ease);
        }
        .faq.open .faq-toggle {
          color: var(--blue-400);
          border-color: rgba(46,168,255,0.30);
          background: rgba(46,168,255,0.08);
        }
        .faq-a-wrap {
          display: grid;
          grid-template-rows: 0fr;
          transition: grid-template-rows .35s var(--ease);
        }
        .faq.open .faq-a-wrap { grid-template-rows: 1fr; }
        .faq-a-wrap > .faq-a {
          overflow: hidden;
          margin: 0;
          padding-left: 60px;
          padding-right: 60px;
          padding-bottom: 0;
          color: var(--ink-300);
        }
        .faq.open .faq-a-wrap > .faq-a {
          padding-bottom: 22px;
        }

        @media (max-width: 600px) {
          .faq-q-text { font-size: 16px; }
          .faq-a-wrap > .faq-a { padding-left: 0; padding-right: 0; }
          .faq-q { grid-template-columns: 28px 1fr 28px; gap: 12px; }
        }
      ` }} />
    </section>
  );
}

/* ===== Footer (Block 11) ===== */

function Footer() {
  const ref = useReveal();
  return (
    <footer className="site-footer" ref={ref as React.RefObject<HTMLElement>}>
      <section className="section foot-cta" id="cta">
        <div className="container">
          <div className="cta-card reveal">
            <div className="cta-grid">
              <div className="cta-copy">
                <span className="eyebrow">Final word</span>
                <h2 className="h-section cta-h">
                  Your competitors are automating <em>right now</em>.
                </h2>
                <p className="body-lg" style={{ maxWidth: 580, color: 'var(--ink-300)' }}>
                  Every week you wait, they get faster, sharper, and harder to catch.
                </p>
              </div>
              <div className="cta-actions">
                <Magnetic strength={8}>
                  <a href="#book" className="btn btn-primary btn-xl">
                    Book your free operations audit <Icon.Arrow className="arrow" />
                  </a>
                </Magnetic>
                <a href="mailto:hello@kyveriqx.com" className="cta-mail">
                  <Icon.Mail /> hello@kyveriqx.com
                </a>
              </div>
            </div>
            <div className="cta-bg" aria-hidden="true" />
            <div className="cta-bg-grid" aria-hidden="true" />
          </div>
        </div>
      </section>

      <div className="container foot-main">
        <div className="foot-grid">
          <div className="foot-brand">
            <div className="foot-mark">
              <span className="nav-mark" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 19V5M5 12l8-7M5 12l8 7M13 5h6M13 19h6" />
                </svg>
              </span>
              <span className="foot-wordmark">KYVERIQX</span>
            </div>
            <p className="foot-tag body-md">
              AI-Powered Operational Intelligence for businesses that already run on ERPs and refuse to wait 18 months for results.
            </p>
            <div className="foot-status">
              <span className="dot" />
              <span className="mono">Now booking &mdash; Q3 sprints</span>
            </div>
          </div>

          <div className="foot-col">
            <h4 className="foot-h">Solution</h4>
            <ul>
              <li><a href="#solution">AI Workflow Automation</a></li>
              <li><a href="#solution">Executive Dashboards</a></li>
              <li><a href="#solution">ERP Intelligence Layer</a></li>
              <li><a href="#solution">Manufacturing Intelligence</a></li>
              <li><a href="#solution">Logistics &amp; Distribution</a></li>
              <li><a href="#solution">AI Sales Agents</a></li>
            </ul>
          </div>

          <div className="foot-col">
            <h4 className="foot-h">Company</h4>
            <ul>
              <li><a href="#projects">Projects</a></li>
              <li><a href="#why">Why KYVERIQX</a></li>
              <li><a href="#founder">Founder</a></li>
              <li><a href="#faqs">FAQs</a></li>
              <li><a href="#book">Book a call</a></li>
            </ul>
          </div>

          <div className="foot-col">
            <h4 className="foot-h">Contact</h4>
            <ul>
              <li><a href="mailto:hello@kyveriqx.com">hello@kyveriqx.com</a></li>
              <li><a href="#">LinkedIn &mdash; K. Kanth Chandra</a></li>
              <li><a href="#">YouTube &mdash; K Kant</a></li>
            </ul>
          </div>
        </div>

        <hr className="hr" style={{ margin: '40px 0 24px' }} />

        <div className="foot-bottom">
          <span className="mono">&copy; {new Date().getFullYear()} KYVERIQX. Built in India.</span>
          <div className="foot-legal">
            <a href="#">Privacy</a>
            <a href="#">Terms</a>
            <a href="#">Security</a>
          </div>
        </div>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        .site-footer { position: relative; }

        .foot-cta { padding-top: 60px; padding-bottom: 60px; }
        .cta-card {
          position: relative;
          overflow: hidden;
          padding: 70px 60px;
          border-radius: 28px;
          background:
            linear-gradient(135deg, rgba(46,168,255,0.18) 0%, rgba(0,194,255,0.06) 60%, rgba(13,27,42,0.6) 100%);
          border: 1px solid rgba(46,168,255,0.30);
          box-shadow: 0 40px 100px -40px rgba(0,194,255,0.40);
        }
        .cta-bg {
          position: absolute;
          inset: auto -120px -200px auto;
          width: 600px; height: 600px;
          background: radial-gradient(circle, rgba(0,194,255,0.35), transparent 60%);
          filter: blur(40px);
          z-index: 0;
          pointer-events: none;
        }
        .cta-bg-grid {
          position: absolute; inset: 0;
          background-image:
            linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px);
          background-size: 56px 56px;
          mask-image: radial-gradient(ellipse at left, black 30%, transparent 80%);
          -webkit-mask-image: radial-gradient(ellipse at left, black 30%, transparent 80%);
          pointer-events: none;
        }
        .cta-grid {
          position: relative; z-index: 1;
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 40px;
          align-items: center;
        }
        .cta-h { margin: 6px 0 18px 0; }
        .cta-h em {
          font-style: normal;
          background: linear-gradient(90deg, #2EA8FF, #00C2FF);
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        .cta-actions {
          display: grid; gap: 16px;
          justify-items: end;
        }
        .btn-xl { padding: 18px 28px; font-size: 16px; }
        .cta-mail {
          display: inline-flex; align-items: center; gap: 8px;
          color: var(--ink-300);
          font-size: 14px;
        }
        .cta-mail:hover { color: var(--blue-400); }

        .foot-main {
          padding: 60px 24px 40px;
          max-width: var(--content-w);
        }
        .foot-grid {
          display: grid;
          grid-template-columns: 1.5fr 1fr 1fr 1fr;
          gap: 40px;
        }
        .foot-mark { display: inline-flex; align-items: center; gap: 12px; margin-bottom: 16px; }
        .foot-wordmark {
          font-size: 16px;
          font-weight: 600;
          letter-spacing: 0.04em;
        }
        .foot-tag {
          margin: 0 0 18px 0;
          max-width: 360px;
        }
        .foot-status {
          display: inline-flex; align-items: center; gap: 8px;
          font-size: 12px;
          color: var(--ink-300);
        }

        .foot-col h4 {
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--blue-400);
          margin: 0 0 16px 0;
        }
        .foot-col ul {
          list-style: none; padding: 0; margin: 0;
          display: grid; gap: 10px;
        }
        .foot-col a {
          color: var(--ink-300);
          font-size: 14px;
          transition: color .2s var(--ease);
        }
        .foot-col a:hover { color: var(--ink-100); }

        .foot-bottom {
          display: flex; align-items: center; justify-content: space-between;
          font-size: 12px;
          color: var(--ink-500);
          flex-wrap: wrap; gap: 16px;
        }
        .foot-legal { display: flex; gap: 18px; }
        .foot-legal a { color: var(--ink-400); }
        .foot-legal a:hover { color: var(--ink-100); }

        @media (max-width: 960px) {
          .cta-card { padding: 50px 32px; }
          .cta-grid { grid-template-columns: 1fr; }
          .cta-actions { justify-items: start; }
          .foot-grid { grid-template-columns: 1fr 1fr; }
        }
        @media (max-width: 540px) {
          .foot-grid { grid-template-columns: 1fr; }
        }
      ` }} />
    </footer>
  );
}

/* ===== Composed app (Block 12) ===== */

export function Landing() {
  return (
    <div id="kyveriqx-root">
      <Nav />
      <main>
        <Hero />
        <Problem />
        <Solution />
        <Projects />
        <WhyUs />
        <Founder />
        <BookCall />
        <FAQs />
      </main>
      <Footer />
    </div>
  );
}
