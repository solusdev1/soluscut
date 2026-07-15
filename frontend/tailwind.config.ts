import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        hydra: {
          bg: "#0b0e14",
          panel: "#141922",
          accent: "#00e5ff",
          safe: "#22c55e",
          face: "#f59e0b",
        },
      },
    },
  },
  plugins: [],
};

export default config;
