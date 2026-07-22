import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        // Inter is the Latin/UI font (loaded via next/font/google, CSS var --font-inter).
        // Noto Sans Ethiopic is now also loaded via next/font/google (CSS var --font-ethiopic)
        // so Amharic glyphs download on any device, including iOS + older Android, instead
        // of falling back to system Ethiopic fonts (which may not exist → tofu boxes).
        // Abyssinica SIL and Nyala remain as CSS fallbacks for edge cases.
        sans: [
          "var(--font-inter)",
          "system-ui",
          "sans-serif",
        ],
        ethiopic: [
          "var(--font-ethiopic)",
          "Abyssinica SIL",
          "Nyala",
          "sans-serif",
        ],
        // Unbounded — display face for headings, prices, stats, marquee
        // (loaded via next/font/google in app/layout.tsx, CSS var --font-display).
        display: [
          "var(--font-display)",
          "var(--font-inter)",
          "sans-serif",
        ],
      },
      colors: {
        // Keep existing (admin/auth pages rely on these)
        ink: "#0e0d0b",
        "ink-2": "#171511",
        cream: "#f6f2ea",
        paper: "#fffdf8",
        "accent-amber": "#ffb25e",
        "accent-green": "#1e9e5a",
        line: "#e7e0d2",
        muted: "#8b8576",

        // CHANGED: accent from orange to red (storefront + anywhere `accent` is used)
        accent: "var(--color-accent)",
        "accent-deep": "var(--color-accent-hover)",

        // NEW: dark theme surface tokens
        dark: "var(--color-bg)",
        surface: "var(--color-surface)",
        "surface-2": "var(--color-surface-2)",
        "th-text": "var(--color-text)",
        "th-muted": "var(--color-text-muted)",
        "th-border": "var(--color-border)",
      },
    },
  },
  plugins: [],
};

export default config;
