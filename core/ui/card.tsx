/* Shared card surface — used for tool tiles, dashboard panels, etc. */

import type { HTMLAttributes, ReactNode } from "react";

type Props = HTMLAttributes<HTMLDivElement> & { children: ReactNode };

export function Card({ children, style, ...rest }: Props) {
  return (
    <div
      {...rest}
      style={{
        background: "linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.015))",
        border: "1px solid var(--line)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--shadow-card)",
        position: "relative",
        overflow: "hidden",
        ...style,
      }}
    >
      {children}
    </div>
  );
}
