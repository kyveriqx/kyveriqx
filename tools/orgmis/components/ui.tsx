"use client";
import { ReactNode, ButtonHTMLAttributes } from "react";
import { cn } from "@orgmis/lib/utils";

export function Card({
  title,
  subtitle,
  action,
  children,
  className,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("bg-white rounded-xl border border-slate-200 shadow-card", className)}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-4 px-6 py-4 border-b border-slate-100">
          <div>
            {title && <h2 className="font-semibold text-slate-900 text-base">{title}</h2>}
            {subtitle && <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>}
          </div>
          {action && <div className="flex-shrink-0">{action}</div>}
        </header>
      )}
      <div className="p-6">{children}</div>
    </section>
  );
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  children,
  ...rest
}: BtnProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 font-medium rounded-lg transition-all",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        size === "sm" && "px-3 py-1.5 text-sm",
        size === "md" && "px-4 py-2 text-sm",
        size === "lg" && "px-6 py-3 text-base",
        variant === "primary" &&
          "bg-brand-700 text-white hover:bg-brand-500 shadow-sm",
        variant === "secondary" &&
          "bg-white text-brand-700 border border-slate-300 hover:bg-slate-50",
        variant === "ghost" && "text-slate-600 hover:bg-slate-100",
        variant === "danger" && "bg-red-600 text-white hover:bg-red-700",
        className
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        "w-full px-3 py-2 rounded-lg border border-slate-300 bg-white",
        "focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500",
        "text-slate-900 placeholder:text-slate-400 text-sm transition",
        props.className
      )}
    />
  );
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={cn(
        "w-full px-3 py-2 rounded-lg border border-slate-300 bg-white",
        "focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500",
        "text-slate-900 placeholder:text-slate-400 text-sm transition resize-y min-h-[80px]",
        props.className
      )}
    />
  );
}

export function Label({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="block text-sm font-medium text-slate-700 mb-1.5">
      {children}
    </label>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger" | "brand";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium",
        tone === "neutral" && "bg-slate-100 text-slate-700",
        tone === "success" && "bg-emerald-100 text-emerald-800",
        tone === "warning" && "bg-amber-100 text-amber-800",
        tone === "danger" && "bg-red-100 text-red-800",
        tone === "brand" && "bg-brand-50 text-brand-700"
      )}
    >
      {children}
    </span>
  );
}

export function Stat({
  label,
  value,
  sub,
  accent,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
  tone?: "neutral" | "success" | "danger" | "brand";
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-card">
      <div
        className={cn(
          "h-1 -mx-5 -mt-5 mb-3 rounded-t-xl",
          tone === "brand" && "bg-brand-700",
          tone === "success" && "bg-emerald-500",
          tone === "danger" && "bg-red-500",
          tone === "neutral" && "bg-slate-300"
        )}
        style={accent ? { background: accent } : undefined}
      />
      <div className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</div>
      <div
        className={cn(
          "text-2xl font-bold mt-1",
          tone === "danger" ? "text-red-600" : "text-slate-900"
        )}
      >
        {value}
      </div>
      {sub && <div className="text-xs text-slate-500 mt-1">{sub}</div>}
    </div>
  );
}
