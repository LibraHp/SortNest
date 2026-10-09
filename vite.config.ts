import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
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
          if (
            /node_modules\/(antd|@ant-design|@rc-component|rc-[^/]+)\//.test(
              path,
            )
          )
            return "ui";
          if (/node_modules\/(recharts|d3-[^/]+|victory-vendor)\//.test(path))
            return "charts";
        },
      },
    },
  },
});
