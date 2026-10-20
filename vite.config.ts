import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig(({ mode }) => ({
  plugins: mode === "single" ? [viteSingleFile()] : [],
  base: mode === "gh-pages" ? "/circuit-sandbox" : "/",
}));
