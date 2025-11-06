import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

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
  const geoCache = JSON.parse(localStorage.getItem("geoCache") || "{}");

  // ✅ 로그인
  const handleLogin = async (e) => {
    e.preventDefault();
    console.log("🔐 로그인 시도:", user);
    const { data: users, error } = await supabase.from("users").select("*").eq("id", user);
    if (error) return alert("Supabase 오류 발생");

    if (users && users.length > 0 && users[0].password === password) {
      console.log("✅ 로그인 성공:", users[0]);
      await loadExcel(users[0].data_file);
      setLoggedIn(true);
    } else {
      alert("로그인 실패: 아이디 또는 비밀번호 확인");
    }
  };

  // ✅ 엑셀 로드
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
          meter_id: row["계기번호"],
          address: row["주소"],
          status: row["진행"] || "미방문",
        }))
      );
    } catch (err) {
      console.error("❌ 엑셀 로드 실패:", err.message);
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

  // ✅ 지도 렌더링
  useEffect(() => {
    if (!map || data.length === 0) return;
    console.log("🧭 지도 렌더링 시작 — 데이터 행 수:", data.length);
    renderMarkers();
  }, [map, data]);

  // ✅ 지오코더 캐싱 함수
  const geocodeAddress = (geocoder, address) =>
    new Promise((resolve) => {
      if (geoCache[address]) {
        console.log(`💾 캐시 HIT: ${address}`);
        return resolve(geoCache[address]);
      }

      geocoder.addressSearch(address, (result, status) => {
        if (status === window.kakao.maps.services.Status.OK) {
          const lat = parseFloat(result[0].y).toFixed(4);
          const lng = parseFloat(result[0].x).toFixed(4);
          geoCache[address] = { lat, lng };
          localStorage.setItem("geoCache", JSON.stringify(geoCache));
          console.log(`🌐 API FETCH: ${address} → (${lat}, ${lng})`);
          resolve({ lat, lng });
        } else {
          console.warn(`⚠️ 변환 실패: ${address} (${status})`);
          resolve(null);
        }
      });
    });

  // ✅ 마커 렌더링
  const renderMarkers = async () => {
    console.log("🧹 기존 마커 제거 중...");
    markers.forEach((m) => m.setMap && m.setMap(null));
    markers = [];

    const geocoder = new window.kakao.maps.services.Geocoder();
    const grouped = {};
    const statusCount = { 완료: 0, 불가: 0, 미방문: 0 };

    for (const d of data) statusCount[d.status] = (statusCount[d.status] || 0) + 1;
    setCounts(statusCount);

    for (const row of data) {
      const coords = await geocodeAddress(geocoder, row.address);
      if (!coords) continue;

      const coordKey = `${coords.lat},${coords.lng}`;
      if (!grouped[coordKey]) grouped[coordKey] = { coords, list: [] };
      grouped[coordKey].list.push(row);
    }

    console.log(`📦 총 ${Object.keys(grouped).length}개의 좌표 그룹 생성`);

    Object.keys(grouped).forEach((key) => {
      const { coords, list } = grouped[key];
      const 진행 = list[0].status;
      const color = 진행 === "완료" ? "green" : 진행 === "불가" ? "red" : "blue";
      const kakaoCoord = new window.kakao.maps.LatLng(coords.lat, coords.lng);

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
        z-index:9999;
        box-shadow:0 0 5px rgba(0,0,0,0.4);
      `;
      overlayEl.innerHTML = `${list.length}`;

      const overlay = new window.kakao.maps.CustomOverlay({
        position: kakaoCoord,
        content: overlayEl,
        yAnchor: 1,
        zIndex: 9999,
      });
      overlay.setMap(map);
      markers.push(overlay);

      // 팝업
      overlayEl.addEventListener("click", (e) => {
        e.stopPropagation();
        if (activeOverlay) activeOverlay.setMap(null);

        const popupEl = document.createElement("div");
        popupEl.style.cssText = `
          background:white;
          padding:10px;
          border:1px solid #ccc;
          border-radius:8px;
          box-shadow:0 2px 5px rgba(0,0,0,0.3);
          z-index:10000;
        `;
        popupEl.innerHTML = `
          <b>${list[0].address}</b><br><br>
          ${list.map((g) => `<div>계기번호: ${g.meter_id}</div>`).join("")}
          <hr/>
          <button id="doneBtn">완료</button>
          <button id="failBtn">불가</button>
          <button id="todoBtn">미방문</button>
        `;

        const popupOverlay = new window.kakao.maps.CustomOverlay({
          position: kakaoCoord,
          content: popupEl,
          yAnchor: 1.5,
          zIndex: 10000,
        });
        popupOverlay.setMap(map);
        activeOverlay = popupOverlay;

        ["doneBtn", "failBtn", "todoBtn"].forEach((id) => {
          const btn = popupEl.querySelector(`#${id}`);
          if (!btn) return;
          btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const label = e.target.innerText;
            const newStatus =
              label === "완료" ? "완료" : label === "불가" ? "불가" : "미방문";
            updateStatus(list.map((g) => g.address), newStatus);
          });
        });
      });
    });

    window.kakao.maps.event.addListener(map, "click", () => {
      if (activeOverlay) {
        activeOverlay.setMap(null);
        activeOverlay = null;
      }
    });
  };

  // ✅ 상태 업데이트
  const updateStatus = async (addrList, status) => {
    console.log(`🛠️ 상태 업데이트 시도 (${addrList.length}개) → ${status}`);
    const updated = data.map((d) =>
      addrList.includes(d.address) ? { ...d, status } : d
    );
    setData(updated);
    const { error } = await supabase.from("meters").upsert(updated);
    if (error) console.error("❌ Supabase 업데이트 실패:", error.message);
    else console.log("✅ Supabase 업데이트 성공");
  };

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
