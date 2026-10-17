import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const HUB = process.env.HUB_URL ?? "http://localhost:8787";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "CO₂LAB",
        short_name: "CO₂LAB",
        description: "Your old devices, working together to find food deals.",
        theme_color: "#dfe6ec",
        background_color: "#dfe6ec",
        display: "standalone",
        start_url: "/",
        icons: [{ src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }],
      },
      workbox: {
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api/, /^\/ws/],
      },
    }),
  ],
  server: {
    host: true,
    proxy: {
      "/api": { target: HUB, changeOrigin: true },
      "/ws": { target: HUB, ws: true, changeOrigin: true },
    },
  },
});
