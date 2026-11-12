import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    // Permite abrir o servidor de desenvolvimento por um túnel Cloudflare (link para fora de casa).
    allowedHosts: [".trycloudflare.com"],
    proxy: {
      "/api": "http://localhost:4000",
      "/uploads": "http://localhost:4000"
    }
  }
});
