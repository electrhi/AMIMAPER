import React, { useEffect, useState, useRef } from "react";
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

  const geoCache = JSON.parse(localStorage.getItem("geoCache") || "{}");
  const markers = useRef([]);
  const activeOverlay = useRef(null);
  const userMarker = useRef(null);

  /* ---------------------- 로그인 ---------------------- */
  const handleLogin = async (e) => {
    e.preventDefault();
    console.log("🔐 로그인 시도:", user);

    const { data: users, error } = await supabase.from("users").select("*").eq("id", user);
    if (error) return console.error("❌ Supabase 오류:", error.message);

    if (users?.length && users[0].password === password) {
      console.log("✅ 로그인 성공:", users[0]);
      await loadData(users[0].data_file);
      setLoggedIn(true);
    } else {
      alert("로그인 실패");
    }
  };

  /* ---------------------- 엑셀 + DB 병합 ---------------------- */
  const loadData = async (fileName) => {
    console.log("📂 엑셀 로드 시도:", fileName);
    const { data: excelBlob, error } = await supabase.storage.from("excels").download(fileName);
    if (error) {
      console.error("❌ 엑셀 로드 실패:", error.message);
      return;
    }

    const blob = await excelBlob.arrayBuffer();
    const workbook = XLSX.read(blob, { type: "array" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json(sheet);
    console.log("📊 엑셀 데이터 로드 완료:", json.length, "행");

    const baseData = json.map((r) => ({
      meter_id: r["계기번호"],
      address: (r["주소"] || "").trim(),
      status: r["진행"] || "미방문",
    }));

    const { data: dbData } = await supabase.from("meters").select("*");
    console.log("🧩 DB 데이터 불러옴:", dbData?.length || 0);

    const merged = baseData.map((x) => {
      const match = dbData?.find(
        (d) => d.meter_id === x.meter_id && d.address.trim() === x.address
      );
      return match ? { ...x, status: match.status } : x;
    });

    console.log("✅ 병합 완료:", merged.length);
    setData(merged);
  };

  /* ---------------------- Kakao 지도 로드 ---------------------- */
  useEffect(() => {
    if (!loggedIn) return;

    console.log("🗺️ Kakao 지도 스크립트 로드 시도...");
    const loadScript = () => {
      const existingScript = document.getElementById("kakao-sdk");
      if (existingScript) {
        console.log("📦 Kakao SDK 이미 존재, load() 실행");
        window.kakao.maps.load(initMap);
        return;
      }

      const script = document.createElement("script");
      script.id = "kakao-sdk";
      script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_KEY}&autoload=false&libraries=services`;
      script.onload = () => {
        console.log("📦 Kakao SDK 로드 완료 → load() 실행");
        window.kakao.maps.load(initMap);
      };
      script.onerror = (err) => {
        console.error("❌ Kakao SDK 로드 실패:", err);
        setTimeout(loadScript, 500);
      };
      document.head.appendChild(script);
    };

    const initMap = () => {
      const container = document.getElementById("map");
      if (!container) {
        console.warn("⚠️ map DOM 없음 — 재시도");
        return setTimeout(initMap, 300);
      }

      console.log("🧭 지도 객체 생성 시작");
      const mapInstance = new window.kakao.maps.Map(container, {
        center: new window.kakao.maps.LatLng(37.5665, 126.9780),
        level: 6,
      });
      setMap(mapInstance);

      // ✅ 내 위치 중심 이동
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const lat = pos.coords.latitude;
            const lng = pos.coords.longitude;
            const locPosition = new window.kakao.maps.LatLng(lat, lng);
            mapInstance.setCenter(locPosition);
            showMyLocationMarker(lat, lng, mapInstance);
            console.log("📍 내 위치 중심 이동 완료");
          },
          (err) => console.warn("⚠️ 위치 정보 실패:", err.message)
        );
      }
    };

    loadScript();
  }, [loggedIn]);

  /* ---------------------- 내 위치 마커 ---------------------- */
  const showMyLocationMarker = (lat, lng, mapInstance = map) => {
    if (!mapInstance) return;
    const markerContent = document.createElement("div");
    markerContent.innerHTML = `
      <div style="
        background:#3182f6;
        color:white;
        border:2px solid white;
        border-radius:15px;
        padding:3px 8px;
        font-size:13px;
        font-weight:bold;
        box-shadow:0 0 5px rgba(0,0,0,0.3);
      ">
        📍 ${user}
      </div>
    `;
    const position = new window.kakao.maps.LatLng(lat, lng);
    if (!userMarker.current) {
      userMarker.current = new window.kakao.maps.CustomOverlay({
        position,
        content: markerContent,
        yAnchor: 1.3,
        zIndex: 9999,
      });
      userMarker.current.setMap(mapInstance);
    } else {
      userMarker.current.setPosition(position);
    }
  };

  /* ---------------------- Geocoder (캐싱) ---------------------- */
  const geocodeAddress = (geocoder, address) =>
    new Promise((resolve) => {
      if (geoCache[address]) {
        console.log(`💾 캐시 HIT: ${address}`);
        return resolve(geoCache[address]);
      }
      geocoder.addressSearch(address, (result, status) => {
        if (status === window.kakao.maps.services.Status.OK) {
          const lat = parseFloat(result[0].y);
          const lng = parseFloat(result[0].x);
          geoCache[address] = { lat, lng };
          localStorage.setItem("geoCache", JSON.stringify(geoCache));
          console.log(`🌐 Geocode 성공: ${address} → (${lat}, ${lng})`);
          resolve({ lat, lng });
        } else {
          console.warn(`⚠️ Geocode 실패: ${address}`);
          resolve(null);
        }
      });
    });

  /* ---------------------- 마커 렌더링 ---------------------- */
  useEffect(() => {
    if (!map || !data.length) return;
    renderMarkers();
  }, [map, data]);

  const renderMarkers = async () => {
    markers.current.forEach((m) => m.setMap(null));
    markers.current = [];

    const geocoder = new window.kakao.maps.services.Geocoder();
    const grouped = {};
    const statusCount = { 완료: 0, 불가: 0, 미방문: 0 };

    data.forEach((d) => (statusCount[d.status] = (statusCount[d.status] || 0) + 1));
    setCounts(statusCount);

    console.log("📍 마커 렌더링 시작:", data.length, "건");

    for (const row of data) {
      const coords = await geocodeAddress(geocoder, row.address);
      if (!coords) continue;
      const key = `${coords.lat},${coords.lng}`;
      if (!grouped[key]) grouped[key] = { coords, list: [] };
      grouped[key].list.push(row);
    }

    Object.values(grouped).forEach(({ coords, list }) => {
      const status = list[0].status;
      const color = status === "완료" ? "green" : status === "불가" ? "red" : "blue";
      const kakaoCoord = new window.kakao.maps.LatLng(coords.lat, coords.lng);

      const markerEl = document.createElement("div");
      markerEl.style.cssText = `
        background:${color};
        border-radius:50%;
        color:white;
        width:30px;height:30px;line-height:30px;
        text-align:center;font-size:12px;
        box-shadow:0 0 5px rgba(0,0,0,0.4);
        cursor:pointer;
      `;
      markerEl.textContent = list.length;

      const overlay = new window.kakao.maps.CustomOverlay({
        position: kakaoCoord,
        content: markerEl,
        yAnchor: 1,
      });
      overlay.setMap(map);
      markers.current.push(overlay);
    });

    console.log("✅ 마커 렌더링 완료:", markers.current.length, "개");
  };

  /* ---------------------- UI ---------------------- */
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
