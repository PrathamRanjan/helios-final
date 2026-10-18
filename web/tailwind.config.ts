import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "#0a0b0f",
        // HELIOS V2 "control room" tokens — mirror the CSS variables in globals.css
        ink: {
          0: "#06080b",
          1: "#0b0e13",
          2: "#10141b",
          3: "#161b24",
          4: "#1e2530",
        },
        line: "rgba(255,255,255,0.08)",
        signal: { 200: "#a7f3e4", 300: "#5eead4", 400: "#2dd4bf", 500: "#14b8a6" },
        warn: { 300: "#fcd34d", 400: "#f5b83d" },
        risk: { 300: "#fca5a5", 400: "#f87171" },
        // Solar accent is a CSS variable so V2 (.v2 scope) can re-tint every V1
        // panel to the signal palette without touching component code.
        solar: {
          100: "rgb(var(--solar-100) / <alpha-value>)",
          200: "rgb(var(--solar-200) / <alpha-value>)",
          300: "rgb(var(--solar-300) / <alpha-value>)",
          400: "rgb(var(--solar-400) / <alpha-value>)",
          500: "rgb(var(--solar-500) / <alpha-value>)",
          600: "rgb(var(--solar-600) / <alpha-value>)",
        },
      },
      fontFamily: {
        display: ["Space Grotesk", "system-ui", "sans-serif"],
        sans2: ["Geist", "Inter", "system-ui", "sans-serif"],
        mono2: ["Geist Mono", "JetBrains Mono", "ui-monospace", "monospace"],
      },
      boxShadow: {
        panel: "0 20px 60px -10px rgba(0,0,0,0.5)",
      },
    },
  },
  plugins: [],
};

export default config;
