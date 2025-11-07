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
  const [canViewOthers, setCanViewOthers] = useState(false);
  const [mapType, setMapType] = useState(localStorage.getItem("mapType") || "ROADMAP");

  const geoCache = JSON.parse(localStorage.getItem("geoCache") || "{}");
  const markers = useRef([]);
  const clusterer = useRef(null);
  const activeOverlay = useRef(null);
  const userMarker = useRef(null);

  // ✅ 로그인 처리
  const handleLogin = async (e) => {
    e.preventDefault();
    console.log("🔐 로그인 시도:", user);
    const { data: users, error } = await supabase.from("users").select("*").eq("id", user);
    if (error) return console.error("❌ Supabase 오류:", error.message);
    if (users?.length && users[0].password === password) {
      console.log("✅ 로그인 성공:", users[0]);
      setCanViewOthers(!!users[0].can_view_others);
      await loadData(users[0].data_file);
      setLoggedIn(true);
    } else alert("로그인 실패");
  };

  // ✅ 엑셀 + DB 병합
  const loadData = async (fileName) => {
    console.log("📂 엑셀 로드 시도:", fileName);
    const { data: excelBlob } = await supabase.storage.from("excels").download(fileName);
    const blob = await excelBlob.arrayBuffer();
    const workbook = XLSX.read(blob, { type: "array" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json(sheet);
    const baseData = json.map((r) => ({
      meter_id: r["계기번호"],
      address: r["주소"],
      status: r["진행"] || "미방문",
      owner_id: user,
    }));

    const { data: dbData } = await supabase.from("meters").select("*");
    const merged = baseData.map((x) => {
      const match = dbData?.find((d) => d.meter_id === x.meter_id && d.address === x.address);
      return match ? { ...x, status: match.status, owner_id: match.owner_id } : x;
    });

    setData(merged);
  };

  // ✅ 지도 초기화
  useEffect(() => {
    if (!loggedIn) return;
    const script = document.createElement("script");
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_KEY}&autoload=false&libraries=services,clusterer`;
    script.onload = () => {
      window.kakao.maps.load(initMap);
    };
    document.head.appendChild(script);
  }, [loggedIn]);

  const initMap = () => {
    const mapContainer = document.getElementById("map");
    const mapInstance = new window.kakao.maps.Map(mapContainer, {
      center: new window.kakao.maps.LatLng(37.5665, 126.9780),
      level: 6,
      mapTypeId:
        mapType === "SKYVIEW"
          ? window.kakao.maps.MapTypeId.HYBRID
          : window.kakao.maps.MapTypeId.ROADMAP,
    });
    setMap(mapInstance);

    clusterer.current = new window.kakao.maps.MarkerClusterer({
      map: mapInstance,
      averageCenter: true,
      minLevel: 5,
    });

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition((pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const locPosition = new window.kakao.maps.LatLng(lat, lng);
        mapInstance.setCenter(locPosition);
        showMyLocationMarker(lat, lng, mapInstance);
      });
    }

    window.kakao.maps.event.addListener(mapInstance, "click", () => {
      if (activeOverlay.current) activeOverlay.current.setMap(null);
    });
  };

  // ✅ 내 위치 마커
  const showMyLocationMarker = (lat, lng, mapInstance = map) => {
    const content = document.createElement("div");
    content.innerHTML = `<div style="background:#3182f6;color:white;border-radius:15px;padding:3px 8px;font-size:13px;font-weight:bold;">📍 ${user}</div>`;
    const position = new window.kakao.maps.LatLng(lat, lng);
    if (!userMarker.current) {
      userMarker.current = new window.kakao.maps.CustomOverlay({
        position,
        content,
        yAnchor: 1.3,
      });
      userMarker.current.setMap(mapInstance);
    } else userMarker.current.setPosition(position);
  };

  // ✅ 주소 → 좌표
  const geocodeAddress = (geocoder, address) =>
    new Promise((resolve) => {
      if (geoCache[address]) return resolve(geoCache[address]);
      geocoder.addressSearch(address, (result, status) => {
        if (status === window.kakao.maps.services.Status.OK) {
          const lat = parseFloat(result[0].y);
          const lng = parseFloat(result[0].x);
          geoCache[address] = { lat, lng };
          localStorage.setItem("geoCache", JSON.stringify(geoCache));
          resolve({ lat, lng });
        } else resolve(null);
      });
    });

  // ✅ 마커 렌더링
  useEffect(() => {
    if (!map || !data.length) return;
    renderMarkers();
  }, [map, data]);

  const renderMarkers = async () => {
    const geocoder = new window.kakao.maps.services.Geocoder();
    const newMarkers = [];

    for (const row of data) {
      const coords = await geocodeAddress(geocoder, row.address);
      if (!coords) continue;
      const position = new window.kakao.maps.LatLng(coords.lat, coords.lng);

      const marker = new window.kakao.maps.Marker({ position });
      newMarkers.push(marker);

      window.kakao.maps.event.addListener(marker, "click", () => {
        if (activeOverlay.current) activeOverlay.current.setMap(null);
        const popupEl = document.createElement("div");
        popupEl.style.cssText =
          "background:white;padding:10px;border:1px solid #ccc;border-radius:8px;";
        popupEl.innerHTML = `<b>${row.address}</b><br/>계기번호: ${row.meter_id}<hr/>`;

        ["완료", "불가", "미방문"].forEach((text) => {
          const btn = document.createElement("button");
          btn.textContent = text;
          btn.style.marginRight = "5px";
          btn.onclick = async (e) => {
            e.stopPropagation();
            await updateStatus([row.meter_id], text);
          };
          popupEl.appendChild(btn);
        });

        if (canViewOthers && row.owner_id) {
          const info = document.createElement("div");
          info.innerHTML = `📌 담당자: <b>${row.owner_id}</b><br/>🕒 수정시각: ${new Date().toLocaleString()}`;
          popupEl.appendChild(document.createElement("hr"));
          popupEl.appendChild(info);
        }

        const popupOverlay = new window.kakao.maps.CustomOverlay({
          position,
          content: popupEl,
          yAnchor: 1.5,
        });
        popupOverlay.setMap(map);
        activeOverlay.current = popupOverlay;
      });
    }

    clusterer.current.clear();
    clusterer.current.addMarkers(newMarkers);
  };

  // ✅ 상태 업데이트 (Supabase 반영)
  const updateStatus = async (meterIds, newStatus) => {
    const updated = data.map((d) =>
      meterIds.includes(d.meter_id)
        ? { ...d, status: newStatus, owner_id: user }
        : d
    );
    setData(updated);
    await supabase.from("meters").upsert(updated, { onConflict: ["meter_id", "address"] });
  };

  // ✅ 지도 타입 전환
  const toggleMapType = () => {
    if (!map) return;
    const nextType = mapType === "ROADMAP" ? "SKYVIEW" : "ROADMAP";
    setMapType(nextType);
    localStorage.setItem("mapType", nextType);
    map.setMapTypeId(
      nextType === "SKYVIEW"
        ? window.kakao.maps.MapTypeId.HYBRID
        : window.kakao.maps.MapTypeId.ROADMAP
    );
  };

  // ✅ Realtime 구독 (관리자 전용)
  useEffect(() => {
    if (!canViewOthers) return;
    const channel = supabase
      .channel("realtime:meters")
      .on("postgres_changes", { event: "*", schema: "public", table: "meters" }, (payload) => {
        console.log("🔄 실시간 변경 감지:", payload);
        loadData("data1.xlsx"); // 변경 시 데이터 새로고침
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [canViewOthers]);

  // ✅ UI
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
        {canViewOthers && <span style={{ marginLeft: "10px", color: "#ff7f00" }}>🧭 관리자</span>}
      </div>

      {/* 스카이뷰 전환 버튼 */}
      <div
        style={{
          position: "absolute",
          bottom: 15,
          left: 15,
          background: "white",
          padding: "6px 10px",
          borderRadius: "8px",
          boxShadow: "0 2px 5px rgba(0,0,0,0.2)",
          cursor: "pointer",
          zIndex: 99999,
          fontWeight: "bold",
        }}
        onClick={toggleMapType}
      >
        {mapType === "ROADMAP" ? "🛰️ 스카이뷰" : "🗺️ 일반지도"}
      </div>

      <div id="map" style={{ width: "100%", height: "100vh" }}></div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
