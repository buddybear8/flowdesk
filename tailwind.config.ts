import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: {
          primary: "var(--color-background-primary)",
          secondary: "var(--color-background-secondary)",
          tertiary: "var(--color-background-tertiary)",
          info: "var(--color-background-info)",
        },
        text: {
          primary: "var(--color-text-primary)",
          secondary: "var(--color-text-secondary)",
          tertiary: "var(--color-text-tertiary)",
          info: "var(--color-text-info)",
        },
        border: {
          tertiary: "var(--color-border-tertiary)",
          secondary: "var(--color-border-secondary)",
          info: "var(--color-border-info)",
        },
        ramp: {
          blue: { 50: "#E6F1FB", 600: "#185FA5", 800: "#0C447C" },
          green: { 50: "#EAF3DE", 600: "#3B6D11", 800: "#27500A" },
          red: { 50: "#FCEBEB", 600: "#A32D2D", 800: "#791F1F" },
          amber: { 50: "#FAEEDA", 600: "#854F0B", 800: "#633806" },
          purple: { 50: "#EEEDFE", 600: "#534AB7", 800: "#3C3489" },
          gray: { 50: "#F1EFE8", 600: "#5F5E5A", 800: "#444441" },
          teal: { 50: "#E1F5EE", 600: "#0F6E56", 800: "#085041" },
        },
      },
      fontSize: {
        micro: ["10px", { lineHeight: "1.3", letterSpacing: "0.05em" }],
        label: ["11px", { lineHeight: "1.4" }],
        body: ["12px", { lineHeight: "1.6" }],
        h3: ["13px", { lineHeight: "1.4" }],
        h2: ["15px", { lineHeight: "1.4" }],
        h1: ["17px", { lineHeight: "1.4" }],
      },
      borderRadius: {
        md: "8px",
        lg: "12px",
        xl: "16px",
      },
    },
  },
  plugins: [],
};

export default config;
