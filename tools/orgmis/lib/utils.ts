import { clsx, ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCrore(value: number): string {
  if (!isFinite(value)) return "—";
  const cr = value / 1e7;
  const sign = cr < 0 ? "(" : "";
  const close = cr < 0 ? ")" : "";
  return `${sign}₹${Math.abs(cr).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} Cr${close}`;
}

export function formatPercent(value: number, digits = 1): string {
  if (!isFinite(value)) return "—";
  const sign = value < 0 ? "(" : "";
  const close = value < 0 ? ")" : "";
  return `${sign}${Math.abs(value).toFixed(digits)}%${close}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
