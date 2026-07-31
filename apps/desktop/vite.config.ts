import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  // Keep production assets relative to index.html so they load under Tauri's
  // custom protocol as well as the Vite development server.
  base: "./",
  plugins: [react()],
  clearScreen: false,
  server: {
    host: host ?? false,
    port: 1420,
    strictPort: true,
    ...(host
      ? {
          hmr: {
            protocol: "ws" as const,
            host,
            port: 1421,
          },
        }
      : {}),
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
