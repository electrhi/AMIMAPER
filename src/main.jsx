import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

// 🧩 Supabase + Kakao 설정
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY;
const KAKAO_KEY = import.meta.env.VITE_KAKAO_JAVASCRIPT_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function App() {
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [loggedIn, setLoggedIn] = useState(false);
  const [data, setData] = useState([]);
  const [map, setMap] = useState(null);
  const [counts, setCounts] = useState({ 완료: 0, 불가: 0, 미방문: 0 });

  let activeOverlay = null;
  let markers = [];

  // ✅ 로그인 처리
  const handleLogin = async (e) => {
    e.preventDefault();
    console.log("🔐 로그인 시도:", user);

    const { data: users, error } = await supabase.from("users").select("*").eq("id", user);
    if (error) {
      console.error("❌ Supabase 오류:", error.message);
      return alert("Supabase 오류 발생");
    }

    if (users && users.length > 0 && users[0].password === password) {
      console.log("✅ 로그인 성공:", users[0]);
      await loadExcel(users[0].data_file);
      setLoggedIn(true);
    } else {
      console.warn("⚠️ 로그인 실패 — 사용자 또는 비밀번호 불일치");
      alert("로그인 실패: 아이디 또는 비밀번호 확인");
    }
  };

  // ✅ Excel 로드
  const loadExcel = async (fileName) => {
    try {
      console.log("📂 엑셀 로드 시도:", fileName);
      const { data, error } = await supabase.storage.from("excels").download(fileName);
      if (error) throw error;

      const blob = await data.arrayBuffer();
      const workbook = XLSX.read(blob, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(sheet);
      console.log("📊 엑셀 데이터 로드 완료:", json.length, "행");

      setData(
        json.map((row) => ({
          계기번호: row["계기번호"],
          주소: row["주소"],
          진행: row["진행"] || "미방문",
        }))
      );
    } catch (err) {
      console.error("❌ 엑셀 로드 실패:", err.message);
      alert("엑셀 로드 실패: " + err.message);
    }
  };

  // ✅ Kakao 지도 로드
  useEffect(() => {
    if (!loggedIn) return;
    console.log("🗺️ Kakao 지도 스크립트 로드 중...");

    const script = document.createElement("script");
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_KEY}&autoload=false&libraries=services`;
    script.async = true;
    script.onload = () => {
      window.kakao.maps.load(() => {
        const container = document.getElementById("map");
        const mapInstance = new window.kakao.maps.Map(container, {
          center: new window.kakao.maps.LatLng(37.5665, 126.9780),
          level: 5,
        });
        console.log("✅ Kakao 지도 초기화 완료");
        setMap(mapInstance);
      });
    };
    document.head.appendChild(script);
  }, [loggedIn]);

  // ✅ 지도 데이터 렌더링
  useEffect(() => {
    if (!map || data.length === 0) return;
    console.log("🧭 지도 렌더링 시작 — 데이터 행 수:", data.length);
    renderMarkers();
  }, [map, data]);

  // ✅ 마커 렌더링 함수
  const renderMarkers = () => {
    console.log("🧹 기존 마커 제거 중...");
    markers.forEach((m) => m.setMap && m.setMap(null));
    markers = [];

    const geocoder = new window.kakao.maps.services.Geocoder();
    const grouped = {};
    const statusCount = { 완료: 0, 불가: 0, 미방문: 0 };

    data.forEach((row) => {
      if (!grouped[row.주소]) grouped[row.주소] = [];
      grouped[row.주소].push(row);
      statusCount[row.진행] = (statusCount[row.진행] || 0) + 1;
    });
    setCounts(statusCount);

    Object.keys(grouped).forEach((addr, index) => {
      geocoder.addressSearch(addr, (result, status) => {
        console.log(`📍 주소(${index + 1}): ${addr} → 상태: ${status}`);

        if (status !== window.kakao.maps.services.Status.OK) return;
        const coords = new window.kakao.maps.LatLng(result[0].y, result[0].x);
        const group = grouped[addr];
        const 진행 = group[0].진행;
        const color = 진행 === "완료" ? "green" : 진행 === "불가" ? "red" : "blue";

        const marker = new window.kakao.maps.Marker({ position: coords, map });
        markers.push(marker);

        // CustomOverlay 생성
        const overlayEl = document.createElement("div");
        overlayEl.style.cssText = `
          background:${color};
          border-radius:50%;
          color:white;
          font-size:12px;
          width:30px;
          height:30px;
          line-height:30px;
          text-align:center;
          cursor:pointer;
          pointer-events:auto;
        `;
        overlayEl.innerHTML = `${group.length}`;
        const overlay = new window.kakao.maps.CustomOverlay({
          position: coords,
          content: overlayEl,
          yAnchor: 1,
        });
        overlay.setMap(map);
        markers.push(overlay);

        // 팝업 열기
        const showPopup = () => {
          console.log(`🖱️ 마커 클릭됨: ${addr}`);
          if (activeOverlay) activeOverlay.setMap(null);

          const popupEl = document.createElement("div");
          popupEl.style.cssText =
            "background:white;padding:10px;border:1px solid #ccc;border-radius:8px;";
          popupEl.innerHTML = `
            <b>${addr}</b><br><br>
            ${group.map((g) => `<div>계기번호: ${g.계기번호}</div>`).join("")}
            <hr/>
            <button id="doneBtn">완료</button>
            <button id="failBtn">불가</button>
            <button id="todoBtn">미방문</button>
          `;

          const popupOverlay = new window.kakao.maps.CustomOverlay({
            position: coords,
            content: popupEl,
            yAnchor: 1.5,
          });
          popupOverlay.setMap(map);
          activeOverlay = popupOverlay;

          setTimeout(() => {
            const doneBtn = document.getElementById("doneBtn");
            const failBtn = document.getElementById("failBtn");
            const todoBtn = document.getElementById("todoBtn");

            if (!doneBtn || !failBtn || !todoBtn) {
              console.warn("⚠️ 버튼 요소를 찾을 수 없습니다!");
              return;
            }

            doneBtn.onclick = (e) => {
              e.stopPropagation();
              console.log("✅ 완료 버튼 클릭:", addr);
              updateStatus(addr, "완료");
            };
            failBtn.onclick = (e) => {
              e.stopPropagation();
              console.log("❌ 불가 버튼 클릭:", addr);
              updateStatus(addr, "불가");
            };
            todoBtn.onclick = (e) => {
              e.stopPropagation();
              console.log("🟦 미방문 버튼 클릭:", addr);
              updateStatus(addr, "미방문");
            };
          }, 100);
        };

        overlayEl.addEventListener("click", (e) => {
          e.stopPropagation();
          showPopup();
        });
        window.kakao.maps.event.addListener(marker, "click", showPopup);
      });
    });

    window.kakao.maps.event.addListener(map, "click", () => {
      if (activeOverlay) {
        console.log("🧩 지도 클릭 — 팝업 닫기");
        activeOverlay.setMap(null);
        activeOverlay = null;
      }
    });
  };

  // ✅ 상태 업데이트
  const updateStatus = async (addr, status) => {
    console.log(`🛠️ 상태 업데이트 시도: ${addr} → ${status}`);
    const updated = data.map((d) =>
      d.주소 === addr ? { ...d, 진행: status } : d
    );
    setData(updated);
    const { error } = await supabase.from("meters").upsert(updated);
    if (error) console.error("❌ Supabase 업데이트 실패:", error.message);
    else console.log("✅ Supabase 업데이트 성공");
  };

  // ✅ 로그인 UI
  if (!loggedIn)
    return (
      <div style={{ padding: "40px", textAlign: "center" }}>
        <h2>로그인</h2>
        <form onSubmit={handleLogin}>
          <input
            type="text"
            placeholder="아이디"
            value={user}
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

  // ✅ 지도 UI
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
