import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 관리자 지도에서 작업자 마지막 위치는 최근 2시간 이내 기록만 조회하도록
// src/main.jsx의 user_last_locations 조회에 서버 필터를 주입합니다.
// updated_at은 Supabase timestamptz이므로 ISO(UTC) 기준 비교가 시간대와 무관하게 정확합니다.
const recentWorkerLocationsPlugin = () => ({
  name: "recent-worker-locations-2h",
  enforce: "pre",
  transform(code, id) {
    if (!id.endsWith("/src/main.jsx") && !id.endsWith("\\src\\main.jsx")) {
      return null;
    }

    const target = `.from("user_last_locations")\n    .select("user_id,data_file,address,lat,lng,status,updated_at")\n    .not("user_id", "is", null)\n    .order("updated_at", { ascending: false })`;

    if (!code.includes(target)) {
      throw new Error(
        "user_last_locations 조회 구문을 찾지 못했습니다. 최근 2시간 위치 필터 적용 여부를 확인해주세요."
      );
    }

    const twoHoursAgoIsoExpression =
      `new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()`;

    const replacement = `.from("user_last_locations")\n    .select("user_id,data_file,address,lat,lng,status,updated_at")\n    .not("user_id", "is", null)\n    .gte("updated_at", ${twoHoursAgoIsoExpression})\n    .order("updated_at", { ascending: false })`;

    return {
      code: code.replace(target, replacement),
      map: null,
    };
  },
});

export default defineConfig({
  plugins: [recentWorkerLocationsPlugin(), react()],
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
