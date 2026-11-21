import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// O servidor local mais comum é a API no Docker, publicada em 4003.
// Permite substituir o destino quando a API corre diretamente em 4000.
const apiProxyTarget = process.env.VITE_API_PROXY_TARGET || "http://localhost:4003";

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
      "/api": apiProxyTarget,
      "/uploads": apiProxyTarget
    }
  }
}));
