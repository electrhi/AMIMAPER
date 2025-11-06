import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  root: ".", // ✅ index.html의 위치를 명시
  build: {
    outDir: "dist",
  },
  server: {
    port: 5173,
  },
});
