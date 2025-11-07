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
  const [dataFile, setDataFile] = useState(null);
  const [canViewOthers, setCanViewOthers] = useState(false);
  const [mapType, setMapType] = useState(localStorage.getItem("mapType") || "ROADMAP");

  const activeOverlay = useRef(null);
  const markers = useRef([]);
  const geoCache = JSON.parse(localStorage.getItem("geoCache") || "{}");
  const userMarker = useRef(null);
  const otherUsers = useRef({});

  // ✅ 로그인
  const handleLogin = async (e) => {
    e.preventDefault();
    console.log("🔐 로그인 시도:", user);
    const { data: users, error } = await supabase.from("users").select("*").eq("id", user);
    if (error) return console.error("❌ Supabase 오류:", error.message);
    if (users?.length && users[0].password === password) {
      console.log("✅ 로그인 성공:", users[0]);
      setDataFile(users[0].data_file);
      setCanViewOthers(!!users[0].can_view_others);
      await loadExcelAndDB(users[0].data_file);
      setLoggedIn(true);
    } else alert("로그인 실패");
  };

  // ✅ 엑셀 + DB 병합
  const loadExcelAndDB = async (fileName) => {
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
      const match = dbData?.find(
        (d) => d.meter_id === x.meter_id && d.address === x.address
      );
      return match ? { ...x, status: match.status } : x;
    });

    setData(merged);
  };

  // ✅ DB 최신 상태 불러오기
  const loadDataFromDB = async () => {
    const { data: dbData, error } = await supabase.from("meters").select("*");
    if (error) return console.error("❌ DB 불러오기 실패:", error.message);
    setData((prev) =>
      prev.map((d) => {
        const match = dbData.find(
          (r) => r.meter_id === d.meter_id && r.address === d.address
        );
        return match ? { ...d, status: match.status } : d;
      })
    );
  };

  // ✅ Kakao 지도 로드 + 내 위치로 이동
  useEffect(() => {
    if (!loggedIn) return;
    const script = document.createElement("script");
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_KEY}&autoload=false&libraries=services`;
    script.onload = () => {
      window.kakao.maps.load(() => {
        const mapInstance = new window.kakao.maps.Map(document.getElementById("map"), {
          level: 6,
          mapTypeId:
            mapType === "SKYVIEW"
              ? window.kakao.maps.MapTypeId.HYBRID
              : window.kakao.maps.MapTypeId.ROADMAP,
        });

        // ✅ 로그인 직후 내 위치 중심으로 이동
        if (navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              const lat = pos.coords.latitude;
              const lng = pos.coords.longitude;
              const locPosition = new window.kakao.maps.LatLng(lat, lng);
              mapInstance.setCenter(locPosition);
              console.log("📍 내 위치로 지도 이동 완료");
              showMyLocationMarker(lat, lng, mapInstance);
            },
            () => console.warn("⚠️ 위치 정보를 가져올 수 없습니다.")
          );
        }

        setMap(mapInstance);
        console.log("✅ Kakao 지도 초기화 완료");
      });
    };
    document.head.appendChild(script);
  }, [loggedIn]);

  // ✅ 내 위치 마커 표시
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
        white-space:nowrap;
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
      userMarker.current.setContent(markerContent);
    }
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

  // ✅ 상태 변경
  const updateStatus = async (meterIds, newStatus) => {
    const updated = data.map((d) =>
      meterIds.includes(d.meter_id) ? { ...d, status: newStatus } : d
    );
    setData(updated);
    const payload = updated.filter((d) => meterIds.includes(d.meter_id));

    if (canViewOthers) {
      await supabase.rpc("upsert_meters_admin", { rows: payload });
    } else {
      await supabase.from("meters").upsert(payload, { onConflict: ["meter_id", "address"] });
    }

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        showMyLocationMarker(lat, lng);
        await supabase.from("user_locations").upsert({
          user_id: user,
          lat,
          lng,
          action: newStatus,
          updated_at: new Date().toISOString(),
        });
      });
    }

    await loadDataFromDB();
  };

  // ✅ Geocoder (캐싱)
  const geocodeAddress = (geocoder, address) =>
    new Promise((resolve) => {
      if (geoCache[address]) return resolve(geoCache[address]);
      geocoder.addressSearch(address, (result, status) => {
        if (status === window.kakao.maps.services.Status.OK) {
          const lat = parseFloat(result[0].y).toFixed(4);
          const lng = parseFloat(result[0].x).toFixed(4);
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
    markers.current.forEach((m) => m.setMap(null));
    markers.current = [];

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

    Object.keys(grouped).forEach((key) => {
      const { coords, list } = grouped[key];
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
      markers.current.push(overlay);

      markerEl.addEventListener("click", async (e) => {
        e.stopPropagation();
        await loadDataFromDB();

        if (activeOverlay.current) activeOverlay.current.setMap(null);

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
        popupEl.appendChild(document.createElement("hr"));

        ["완료", "불가", "미방문"].forEach((text) => {
          const btn = document.createElement("button");
          btn.textContent = text;
          btn.style.marginRight = "5px";
          btn.addEventListener("click", async (e) => {
            e.stopPropagation();
            await updateStatus(list.map((g) => g.meter_id), text);
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
        activeOverlay.current = popupOverlay;
      });
    });

    // ✅ 지도 클릭 시 팝업 닫기
    window.kakao.maps.event.addListener(map, "click", () => {
      if (activeOverlay.current) {
        activeOverlay.current.setMap(null);
        activeOverlay.current = null;
      }
    });
  };

  // ✅ 로그인 UI
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

  // ✅ 지도 UI
  return (
    <div style={{ width: "100%", height: "100vh", position: "relative" }}>
      {/* 상태 바 */}
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
        {canViewOthers && (
          <span style={{ marginLeft: "10px", color: "#ff7f00" }}>🧭 관리자</span>
        )}
      </div>

      {/* 지도 타입 전환 버튼 (항상 표시) */}
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
