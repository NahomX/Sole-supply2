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
      },
      colors: {
        // Brand palette — Ethiopian coffee-heritage + flag accent tones.
        // Use brand.amber as the primary CTA accent; espresso/coffee for dark
        // backgrounds; green/gold as secondary accent nods.
        brand: {
          espresso: "#2A1A12", // deep espresso — hero base, CTA button bg
          coffee:   "#3E2A1C", // warm coffee — hero gradient midpoint, hover
          amber:    "#C8742B", // warm amber — primary CTA/accent
          green:    "#1F7A52", // muted green — "in stock" badge
          gold:     "#E8B53A", // secondary accent — highlight elements
        },
      },
    },
  },
  plugins: [],
};

export default config;
