import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY;
const KAKAO_KEY = import.meta.env.VITE_KAKAO_JAVASCRIPT_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function App() {
  const [user, setUser] = useState(null);
  const [password, setPassword] = useState("");
  const [loggedIn, setLoggedIn] = useState(false);
  const [data, setData] = useState([]);
  const [map, setMap] = useState(null);
  const [counts, setCounts] = useState({ 완료: 0, 불가: 0, 미방문: 0 });

  // 로그인 처리
  const handleLogin = async (e) => {
    e.preventDefault();
    const { data: users } = await supabase.from("users").select("*").eq("id", user);
    if (users && users.length > 0 && users[0].password === password) {
      const dataFile = users[0].data_file;
      await loadExcel(dataFile);
      setLoggedIn(true);
    } else {
      alert("로그인 실패: 아이디 또는 비밀번호를 확인하세요.");
    }
  };

  // 엑셀 파일 로드
  const loadExcel = async (fileName) => {
    try {
      const { data, error } = await supabase.storage.from("excels").download(fileName);
      if (error) throw error;
      const blob = await data.arrayBuffer();
      const workbook = XLSX.read(blob, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(sheet);

      const processed = json.map((row) => ({
        계기번호: row["계기번호"],
        주소: row["주소"],
        진행: row["진행"] || "미방문",
      }));
      setData(processed);
    } catch (err) {
      console.error("엑셀 로드 실패:", err.message);
    }
  };

  // 카카오 지도 로드
  useEffect(() => {
    if (!loggedIn) return;

    const script = document.createElement("script");
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_KEY}&autoload=false`;
    script.async = true;

    script.onload = () => {
      window.kakao.maps.load(async () => {
        const container = document.getElementById("map");
        const options = {
          center: new window.kakao.maps.LatLng(37.5665, 126.9780),
          level: 5,
        };
        const mapInstance = new window.kakao.maps.Map(container, options);
        setMap(mapInstance);
      });
    };
    document.head.appendChild(script);
  }, [loggedIn]);

  // 지도 마커 표시
  useEffect(() => {
    if (!map || data.length === 0) return;

    const geocoder = new window.kakao.maps.services.Geocoder();
    const grouped = {};

    // 주소별로 계기번호 묶기
    data.forEach((row) => {
      if (!grouped[row.주소]) grouped[row.주소] = [];
      grouped[row.주소].push(row);
    });

    // 진행 상태 카운트
    const statusCount = { 완료: 0, 불가: 0, 미방문: 0 };
    data.forEach((d) => {
      statusCount[d.진행] = (statusCount[d.진행] || 0) + 1;
    });
    setCounts(statusCount);

    Object.keys(grouped).forEach((addr) => {
      geocoder.addressSearch(addr, (result, status) => {
        if (status === window.kakao.maps.services.Status.OK) {
          const coords = new window.kakao.maps.LatLng(result[0].y, result[0].x);
          const group = grouped[addr];
          const 진행 = group[0].진행;

          const color =
            진행 === "완료" ? "green" : 진행 === "불가" ? "red" : "blue";

          const marker = new window.kakao.maps.CustomOverlay({
            position: coords,
            content: `
              <div style="
                background:${color};
                border-radius:50%;
                color:white;
                font-size:12px;
                width:30px;
                height:30px;
                line-height:30px;
                text-align:center;
              ">
                ${group.length}
              </div>`,
            yAnchor: 1,
          });
          marker.setMap(map);

          // 마커 클릭 이벤트
          window.kakao.maps.event.addListener(marker, "click", () => {
            const content = `
              <div style="background:white; padding:10px; border-radius:8px; border:1px solid #ccc;">
                <b>${addr}</b><br><br>
                ${group
                  .map((g) => `<div>계기번호: ${g.계기번호} (${g.진행})</div>`)
                  .join("")}
                <hr/>
                <button id="doneBtn">완료</button>
                <button id="failBtn">불가</button>
                <button id="todoBtn">미방문</button>
              </div>`;

            const overlay = new window.kakao.maps.CustomOverlay({
              position: coords,
              content: content,
              yAnchor: 1.5,
            });
            overlay.setMap(map);

            // 버튼 클릭 이벤트 연결
            setTimeout(() => {
              document.getElementById("doneBtn").onclick = () =>
                updateStatus(addr, "완료");
              document.getElementById("failBtn").onclick = () =>
                updateStatus(addr, "불가");
              document.getElementById("todoBtn").onclick = () =>
                updateStatus(addr, "미방문");
            }, 100);
          });
        }
      });
    });
  }, [map, data]);

  // 상태 업데이트
  const updateStatus = async (addr, status) => {
    const updated = data.map((d) =>
      d.주소 === addr ? { ...d, 진행: status } : d
    );
    setData(updated);
    await supabase.from("meters").upsert(updated);
  };

  if (!loggedIn) {
    return (
      <div style={{ padding: "40px", textAlign: "center" }}>
        <h2>로그인</h2>
        <form onSubmit={handleLogin}>
          <input
            type="text"
            placeholder="아이디"
            value={user || ""}
            onChange={(e) => setUser(e.target.value)}
          />
          <br />
          <input
            type="password"
            placeholder="비밀번호"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <br />
          <button type="submit">로그인</button>
        </form>
      </div>
    );
  }

  return (
    <div style={{ width: "100%", height: "100vh" }}>
      <div
        style={{
          position: "absolute",
          top: 10,
          left: 10,
          background: "white",
          padding: "5px 10px",
          borderRadius: "8px",
          boxShadow: "0 2px 5px rgba(0,0,0,0.2)",
          zIndex: 10,
        }}
      >
        ✅ 완료: {counts["완료"] || 0} | ❌ 불가: {counts["불가"] || 0} | 🟦 미방문:{" "}
        {counts["미방문"] || 0}
      </div>
      <div id="map" style={{ width: "100%", height: "100vh" }}></div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
