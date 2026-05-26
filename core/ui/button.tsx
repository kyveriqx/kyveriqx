/* Shared button — primary (blue gradient) and ghost variants.
   Visual style maps to the design tokens in /core/styles/tokens.css.
   `size="md"` is the default chunky hero scale; `size="sm"` is a compact
   pill for card-scoped actions (e.g. the /store tool cards). */

import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "ghost";
type Size = "md" | "sm";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
};

export function Button({
  variant = "primary",
  size = "md",
  children,
  style,
  ...rest
}: Props) {
  const sizing =
    size === "sm"
      ? { padding: "8px 14px", fontSize: 13, gap: 6 }
      : { padding: "14px 22px", fontSize: 15, gap: 10 };

  const base = {
    display: "inline-flex",
    alignItems: "center",
    gap: sizing.gap,
    padding: sizing.padding,
    fontSize: sizing.fontSize,
    fontWeight: variant === "primary" ? 600 : 500,
    letterSpacing: "-0.005em",
    borderRadius: "var(--radius-pill)",
    transition:
      "transform .25s var(--ease), background .25s var(--ease), box-shadow .25s var(--ease), color .25s var(--ease)",
    whiteSpace: "nowrap" as const,
  };

  const primary =
    size === "sm"
      ? {
          background: "linear-gradient(180deg, #3FB3FF 0%, #1E8FE0 100%)",
          color: "#07111F",
          boxShadow:
            "0 0 0 1px rgba(255,255,255,0.18) inset, 0 6px 18px -6px rgba(46,168,255,0.40), 0 0 20px -8px rgba(0,194,255,0.28)",
        }
      : {
          background: "linear-gradient(180deg, #3FB3FF 0%, #1E8FE0 100%)",
          color: "#07111F",
          boxShadow:
            "0 0 0 1px rgba(255,255,255,0.18) inset, 0 10px 30px -10px rgba(46,168,255,0.55), 0 0 40px -10px rgba(0,194,255,0.45)",
        };

  const ghost = {
    background: "rgba(255,255,255,0.04)",
    color: "var(--ink-100)",
    border: "1px solid var(--line-strong)",
  };

  return (
    <button
      {...rest}
      style={{ ...base, ...(variant === "primary" ? primary : ghost), ...style }}
    >
      {children}
    </button>
  );
}
