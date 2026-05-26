"use client";

/* Step nav for the 4-step wizard. Sits below the global Kyveriqx Nav.
   Highlights the active step based on the current pathname. */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@orgmis/lib/utils";

const STEPS = [
  { href: "/tools/orgmis/settings", label: "1. Branding" },
  { href: "/tools/orgmis/upload",   label: "2. Upload Data" },
  { href: "/tools/orgmis/preview",  label: "3. Preview" },
  { href: "/tools/orgmis/generate", label: "4. Generate" },
];

export default function StepNav() {
  const pathname = usePathname();

  return (
    <nav className="bg-white border border-slate-200 rounded-xl shadow-card px-3 py-2 flex items-center gap-1 mb-6 overflow-x-auto">
      {STEPS.map((s) => {
        const active = pathname === s.href || (s.href !== "/" && pathname.startsWith(s.href));
        return (
          <Link
            key={s.href}
            href={s.href}
            className={cn(
              "px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap",
              active
                ? "bg-brand-700 text-white"
                : "text-slate-600 hover:text-brand-700 hover:bg-slate-100"
            )}
          >
            {s.label}
          </Link>
        );
      })}
    </nav>
  );
}
