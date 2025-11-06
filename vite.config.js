import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  root: ".", // index.html 위치
  build: {
    outDir: "dist",
  },
  preview: {
    port: 10000,                 // Render가 감지할 포트
    host: "0.0.0.0",             // 외부 접근 허용
    allowedHosts: ["amimaper.onrender.com"], // Render 도메인 허용
  },
});
