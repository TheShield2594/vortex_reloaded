import type { Config } from "tailwindcss"
import plugin from "tailwindcss/plugin"

const config = {
  darkMode: ["class"],
  content: [
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
  ],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        display: ["var(--font-display)", "sans-serif"],
        sans: ["var(--font-body)", "sans-serif"],
      },
      colors: {
        // Vortex Midnight Neon brand palette
        'vortex': {
          'bg-primary': '#1b1f31',    // main content bg
          'bg-secondary': '#151829',  // channel list bg
          'bg-tertiary': '#0f1120',   // server list bg
          'bg-overlay': '#252a42',    // modals, overlays
          'interactive': '#8f9bbf',   // icons, inactive
          'interactive-hover': '#e6ecff', // hover state
          'text-primary': '#e6ecff',
          'text-secondary': '#b6c0dd',
          'text-muted': '#6b7392',
          'accent': '#00e5ff',        // Midnight Neon
          'accent-hover': '#00c8e0',
          'success': '#3ddc97',
          'warning': '#ffb84d',
          'danger': '#ff5d73',
          'link': '#6fd8ff',
          'mention': '#00e5ff1a',
          'mention-border': '#00e5ff',
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      /**
       * Z-index scale — unified with CSS custom properties in globals.css.
       *
       *  base                     →  z-base          (1)
       *  mobile bottom tab bar    →  z-tabbar        (50)
       *  dropdown / autocomplete  →  z-dropdown      (100)
       *  sticky headers           →  z-sticky        (200)
       *  modal backdrop           →  z-modal-backdrop (300)
       *  modals                   →  z-modal         (310)
       *  popovers                 →  z-popover       (400)
       *  tooltips / toasts        →  z-tooltip / toast (500)
       *  notifications            →  z-notification  (600)
       *  overlays                 →  z-overlay       (700)
       *  PWA install banner       →  z-banner        (9998)
       *  push-permission prompt   →  z-banner-high   (9999)
       *  splash screen            →  z-splash        (99999)
       */
      zIndex: {
        base: "1",
        tabbar: "50",
        dropdown: "100",
        sticky: "200",
        "modal-backdrop": "300",
        modal: "310",
        popover: "400",
        tooltip: "500",
        toast: "500",
        notification: "600",
        overlay: "700",
        banner: "9998",
        "banner-high": "9999",
        splash: "99999",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "speaking-pulse": {
          "0%, 100%": { boxShadow: "0 0 0 0 rgba(35, 165, 90, 0.4)" },
          "50%": { boxShadow: "0 0 0 4px rgba(35, 165, 90, 0)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "speaking-pulse": "speaking-pulse 1s ease-in-out infinite",
      },
    },
  },
  plugins: [
    require("tailwindcss-animate"),
    plugin(function ({ addUtilities }) {
      addUtilities({
        /* Force elements visible on touch devices (coarse pointer).
           Use alongside `opacity-0 group-hover:opacity-100` for buttons
           that must be discoverable without a hover cursor. */
        ".touch-visible": {
          "@media (pointer: coarse)": {
            opacity: "1",
            pointerEvents: "auto",
          },
        },
      })
    }),
  ],
} satisfies Config

export default config
