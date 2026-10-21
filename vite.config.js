import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";

// Resolve file and directory paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig(({ command, mode }) => {
  if (command === "build" && mode === "production") {
    const env = loadEnv(mode, __dirname, "VITE_");
    if (env.VITE_SUPABASE_URL !== "https://oowesugpxxzvyvfqqxlu.supabase.co"
      || !/^sb_publishable_[A-Za-z0-9_-]{16,}$/.test(env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "")) {
      throw new Error("Production build requires the confirmed hosted Supabase URL and staging publishable key in .env.production.local or the build environment.");
    }
  }
  return {
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    // Development only: Auth uses HTTP, not Realtime. Keep HMR origins explicit.
    headers: {
      "Content-Security-Policy": "connect-src 'self' http://127.0.0.1:54321 ws://localhost:5173 ws://127.0.0.1:5173",
    },
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
        configure(proxy) {
          proxy.on("proxyReq", (outgoing, incoming) => {
            // Translate only known local browser origins to the local API origin.
            if (["http://localhost:5173", "http://127.0.0.1:5173"].includes(incoming.headers.origin)) {
              outgoing.setHeader("Origin", "http://127.0.0.1:8787");
            }
          });
        },
      },
    },
  },
  build: {
    outDir: path.resolve(__dirname, "dist"),
  },
  resolve: {
    alias: {
      "lottie-web": "lottie-web/build/player/lottie_light.js",
      "@": path.resolve(__dirname, "src"),
    },
  },
  };
});
