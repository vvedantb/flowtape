import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineWebViteConfig, srcAlias } from "@vvedantb/config";
import { defineConfig } from "vite";
// Loaded by `react({ compiler: true })`.
import "oxc-transform-react";

export default defineConfig({
  ...defineWebViteConfig({
    tailwindcss,
    react: { plugin: react, compiler: true },
    alias: srcAlias(import.meta.dirname),
    dedupe: ["react", "react-dom"],
  }),
});
