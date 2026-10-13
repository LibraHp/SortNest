import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    warmup: { clientFiles: ["./src/main.tsx", "./src/App.tsx"] },
  },
  optimizeDeps: {
    include: ["radix-ui", "recharts", "sonner", "lucide-react"],
  },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: {
    target: "chrome110",
    rollupOptions: {
      output: {
        onlyExplicitManualChunks: true,
        manualChunks(id) {
          const path = id.replaceAll("\\", "/");
          if (/node_modules\/(react|react-dom|scheduler)\//.test(path))
            return "react";
          if (/node_modules\/(radix-ui|@radix-ui|sonner|cn)\//.test(path))
            return "ui";
          if (/node_modules\/(recharts|d3-[^/]+|victory-vendor)\//.test(path))
            return "charts";
        },
      },
    },
  },
});
