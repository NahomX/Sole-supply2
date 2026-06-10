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
        // Redesign palette (docs/presentation/redesign/index.html is the source
        // of truth). Names that would clobber Tailwind's default scales
        // (orange/amber/green — AdminDashboard.tsx uses amber-50..900) are
        // namespaced under "accent":
        //   mockup --orange      → accent        #f4641e
        //   mockup --orange-deep → accent-deep   #c8430a
        //   mockup --amber       → accent-amber  #ffb25e
        //   mockup --green       → accent-green  #1e9e5a
        ink: "#0e0d0b",
        "ink-2": "#171511",
        cream: "#f6f2ea",
        paper: "#fffdf8",
        accent: "#f4641e",
        "accent-deep": "#c8430a",
        "accent-amber": "#ffb25e",
        "accent-green": "#1e9e5a",
        line: "#e7e0d2",
        muted: "#8b8576",
      },
    },
  },
  plugins: [],
};

export default config;
