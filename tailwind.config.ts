import type { Config } from "tailwindcss";

/**
 * Tailwind for Kyveriqx — scoped to the BOD MIS / OrgMIS tool's pages.
 *
 * The rest of the site renders via inline `style={}` + CSS-var design
 * tokens (see core/styles/tokens.css). Tailwind utilities are only used
 * inside `tools/orgmis/**` and `app/tools/orgmis/**`.
 *
 * `preflight: false` disables Tailwind's global CSS reset so existing
 * pages keep their look. Utility classes still work where applied.
 */
const config: Config = {
  content: [
    "./tools/orgmis/**/*.{ts,tsx}",
    "./app/tools/orgmis/**/*.{ts,tsx}",
  ],
  corePlugins: {
    preflight: false,
  },
  theme: {
    extend: {
      colors: {
        brand: {
          50:  "#F0F4FA",
          100: "#D9E1F2",
          500: "#2E5597",
          700: "#1F3864",
          900: "#0F1C32",
        },
        gold: {
          300: "#FFD966",
          500: "#BF8F00",
        },
      },
      fontFamily: {
        sans: ['"Segoe UI"', "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 3px rgba(0,0,0,0.05), 0 1px 2px rgba(0,0,0,0.06)",
      },
    },
  },
  plugins: [],
};

export default config;
