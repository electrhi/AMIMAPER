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
    if (error) {
      console.error("❌ Supabase 오류:", error.message);
      return;
    }

    if (users && users.length > 0 && users[0].password === password) {
      console.log("✅ 로그인 성공:", users[0]);
      await loadData(users[0].data_file);
      setLoggedIn(true);
    } else {
      console.warn("🚫 로그인 실패 - 비밀번호 불일치");
      alert("로그인 실패: 아이디 또는 비밀번호 확인");
    }
  };

  // ✅ 엑셀 + DB 병합
  const loadData = async (fileName) => {
    console.log("📂 엑셀 로드 시도:", fileName);
    const { data: excelBlob, error: excelError } = await supabase.storage.from("excels").download(fileName);
    if (excelError) {
      console.error("❌ 엑셀 다운로드 실패:", excelError.message);
      return;
    }

    const blob = await excelBlob.arrayBuffer();
    const workbook = XLSX.read(blob, { type: "array" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json(sheet);
    console.log("📊 엑셀 행 수:", json.length);

    const baseData = json.map((r) => ({
      meter_id: r["계기번호"],
      address: r["주소"],
      status: r["진행"] || "미방문",
    }));

    const { data: dbData, error: dbError } = await supabase.from("meters").select("*");
    if (dbError) console.warn("⚠️ DB 불러오기 실패:", dbError.message);

    const merged = baseData.map((x) => {
      const match = dbData?.find((d) => d.meter_id === x.meter_id && d.address === x.address);
      return match ? { ...x, status: match.status } : x;
    });

    console.log("✅ 데이터 병합 완료:", merged.length);
    setData(merged);
  };

  // ✅ Kakao 지도 로드
  useEffect(() => {
    if (!loggedIn) return;
    console.log("🗺️ Kakao 지도 스크립트 로드 중...");
    const script = document.createElement("script");
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_KEY}&autoload=false&libraries=services`;
    script.onload = () => {
      console.log("📦 Kakao SDK 로드 완료, 지도 초기화 중...");
      window.kakao.maps.load(() => {
        const mapInstance = new window.kakao.maps.Map(document.getElementById("map"), {
          center: new window.kakao.maps.LatLng(37.5665, 126.9780),
          level: 5,
        });
        console.log("✅ 지도 초기화 완료");
        setMap(mapInstance);
      });
    };
    document.head.appendChild(script);
  }, [loggedIn]);

  // ✅ Kakao Geocoder (캐싱)
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
          console.log(`🌐 API 결과: ${address} → (${lat}, ${lng})`);
          resolve({ lat, lng });
        } else {
          console.warn(`⚠️ 지오코딩 실패: ${address} → ${status}`);
          resolve(null);
        }
      });
    });

  // ✅ 지도 렌더링
  useEffect(() => {
    if (!map || data.length === 0) return;
    console.log("🧭 지도 렌더링 시작...");
    renderMarkers();
  }, [map, data]);

  const renderMarkers = async () => {
    console.log("🧹 기존 마커 제거 중...");
    markers.forEach((m) => m.setMap(null));
    markers = [];

    const geocoder = new window.kakao.maps.services.Geocoder();
    const grouped = {};
    const statusCount = { 완료: 0, 불가: 0, 미방문: 0 };

    data.forEach((d) => (statusCount[d.status] = (statusCount[d.status] || 0) + 1));
    setCounts(statusCount);

    for (const row of data) {
      const coords = await geocodeAddress(geocoder, row.address);
      if (!coords) continue;
      const key = `${coords.lat},${coords.lng}`;
      if (!grouped[key]) grouped[key] = { coords, list: [] };
      grouped[key].list.push(row);
    }

    console.log("📍 총 그룹 수:", Object.keys(grouped).length);

    Object.keys(grouped).forEach((key, i) => {
      const { coords, list } = grouped[key];
      console.log(`📍 마커 생성 (${i + 1})`, list.map((l) => l.address));

      const 진행 = list[0].status;
      const color = 진행 === "완료" ? "green" : 진행 === "불가" ? "red" : "blue";
      const kakaoCoord = new window.kakao.maps.LatLng(coords.lat, coords.lng);

      const markerEl = document.createElement("div");
      markerEl.style.cssText = `
        background:${color};
        border-radius:50%;
        color:white;
        font-size:12px;
        width:30px;
        height:30px;
        line-height:30px;
        text-align:center;
        cursor:pointer;
        box-shadow:0 0 5px rgba(0,0,0,0.4);
      `;
      markerEl.textContent = list.length;

      const overlay = new window.kakao.maps.CustomOverlay({
        position: kakaoCoord,
        content: markerEl,
        yAnchor: 1,
      });
      overlay.setMap(map);
      markers.push(overlay);

      markerEl.addEventListener("click", (e) => {
        e.stopPropagation();
        console.log("🖱️ 마커 클릭됨:", list[0].address);

        if (activeOverlay) {
          console.log("🧹 기존 팝업 제거");
          activeOverlay.setMap(null);
        }

        const popupEl = document.createElement("div");
        popupEl.style.cssText = `
          background:white;
          padding:10px;
          border:1px solid #ccc;
          border-radius:8px;
        `;

        const title = document.createElement("b");
        title.textContent = list[0].address;
        popupEl.appendChild(title);
        popupEl.appendChild(document.createElement("br"));
        popupEl.appendChild(document.createElement("br"));

        list.forEach((g) => {
          const div = document.createElement("div");
          div.textContent = `계기번호: ${g.meter_id}`;
          popupEl.appendChild(div);
        });

        const hr = document.createElement("hr");
        popupEl.appendChild(hr);

        const btns = [
          { text: "완료" },
          { text: "불가" },
          { text: "미방문" },
        ];

        btns.forEach((b) => {
          const btn = document.createElement("button");
          btn.textContent = b.text;
          btn.style.marginRight = "5px";
          btn.addEventListener("click", async (ev) => {
            ev.stopPropagation();
            console.log(`🔘 버튼 클릭됨: ${b.text} (${list[0].address})`);
            await updateStatus(list.map((g) => g.meter_id), b.text);
          });
          popupEl.appendChild(btn);
        });

        const popupOverlay = new window.kakao.maps.CustomOverlay({
          position: kakaoCoord,
          content: popupEl,
          yAnchor: 1.5,
          zIndex: 10000,
        });
        popupOverlay.setMap(map);
        activeOverlay = popupOverlay;
        console.log("🧩 팝업 표시 완료:", list[0].address);
      });
    });

    window.kakao.maps.event.addListener(map, "click", () => {
      console.log("🧩 지도 클릭 발생 — 팝업 닫기 시도");
      if (activeOverlay) {
        activeOverlay.setMap(null);
        console.log("🧩 지도 클릭 — 팝업 닫기 실행");
      }
    });
  };

  // ✅ Supabase 업데이트
  const updateStatus = async (meterIds, newStatus) => {
    console.log("🛠️ 상태 업데이트 요청:", meterIds, "→", newStatus);
    const updated = data.map((d) =>
      meterIds.includes(d.meter_id) ? { ...d, status: newStatus } : d
    );
    setData(updated);

    const payload = updated.filter((d) => meterIds.includes(d.meter_id));
    console.log("📦 업데이트 대상:", payload);

    const { error } = await supabase.from("meters").upsert(payload, {
      onConflict: ["meter_id", "address"],
    });

    if (error) {
      console.error("❌ Supabase 저장 실패:", error.message);
    } else {
      console.log("✅ Supabase 저장 완료");
    }

    renderMarkers();
  };

  if (!loggedIn)
    return (
      <div style={{ textAlign: "center", marginTop: "100px" }}>
        <h2>로그인</h2>
        <form onSubmit={handleLogin}>
          <input value={user} onChange={(e) => setUser(e.target.value)} placeholder="아이디" />
          <br />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="비밀번호"
          />
          <br />
          <button type="submit">로그인</button>
        </form>
      </div>
    );

  return (
    <div style={{ width: "100%", height: "100vh", position: "relative" }}>
      {/* ✅ 상태바 항상 최상단 */}
      <div
        style={{
          position: "absolute",
          top: 10,
          left: 10,
          background: "white",
          padding: "8px 12px",
          borderRadius: "8px",
          boxShadow: "0 2px 5px rgba(0,0,0,0.2)",
          zIndex: 99999,
          fontWeight: "bold",
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
