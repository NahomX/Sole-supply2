import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        // Ethiopic (Geez) font stack for Amharic text — ensures "በረባሶ" and
        // other Amharic strings render correctly on Windows, iOS, and Android.
        // Noto Sans Ethiopic covers the full Ethiopic Unicode block; Abyssinica
        // SIL and Nyala are common system fallbacks.
        sans: [
          "var(--font-inter)",
          "Noto Sans Ethiopic",
          "Abyssinica SIL",
          "Nyala",
          "system-ui",
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
