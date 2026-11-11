import { defineConfig } from "vite";
import { devPrivateFiles } from "./scripts/dev-private-files.ts";

export default defineConfig({
  server: { host: "127.0.0.1", proxy: { "/api": "http://127.0.0.1:3000", "/pottery/api": "http://127.0.0.1:3000" } },
  plugins: [devPrivateFiles()],
});
