import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// O build corre por scripts/build.mjs, que garante NODE_ENV=production antes do Vite arrancar.
export default defineConfig(() => ({
  plugins: [react()],
  build: {
    // Bibliotecas que mudam pouco ficam num ficheiro próprio: o browser guarda-o em cache entre versões do Tchilar.
    rollupOptions: {
      output: {
        manualChunks: id => {
          if (/node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom)[\\/]/.test(id)) return "vendor-react";
          if (/node_modules[\\/]lucide-react[\\/]/.test(id)) return "vendor-icons";
          return undefined;
        }
      }
    }
  },
  server: {
    host: "0.0.0.0",
    // Permite abrir o servidor de desenvolvimento por um túnel Cloudflare (link para fora de casa).
    allowedHosts: [".trycloudflare.com"],
    proxy: {
      "/api": "http://localhost:4000",
      "/uploads": "http://localhost:4000"
    }
  }
}));
