import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: { extend: { colors: { ink: "#101828", muted: "#667085", brand: { DEFAULT: "#635bff", dark: "#5148e5" } }, boxShadow: { soft: "0 12px 32px rgba(16,24,40,.06)" } } },
  plugins: []
};
export default config;
