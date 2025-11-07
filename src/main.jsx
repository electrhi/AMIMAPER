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

  /* 🧭 로그인 */
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

  /* 📂 엑셀 + DB 병합 */
  const loadExcelAndDB = async (fileName) => {
    console.log("📂 엑셀 로드 시도:", fileName);
    const { data: excelBlob, error: excelError } = await supabase.storage
      .from("excels")
      .download(fileName);

    if (excelError || !excelBlob) {
      console.error("❌ 엑셀 파일 불러오기 실패:", excelError?.message);
      return;
    }

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

    const { data: dbData, error: dbError } = await supabase.from("meters").select("*");
    if (dbError) {
      console.error("❌ DB 불러오기 실패:", dbError.message);
      setData(baseData);
      return;
    }

    const merged = baseData.map((x) => {
      const match = dbData?.find(
        (d) => d.meter_id === x.meter_id && d.address === x.address
      );
      return match
        ? { ...x, status: match.status, owner_id: match.owner_id || user }
        : x;
    });

    console.log("✅ 데이터 병합 완료:", merged.length);
    setData(merged);
  };

  /* 🔄 DB 데이터 새로고침 */
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

  /* 🗺️ Kakao 지도 로드 (공식 문서 기반 안정화 버전) */
  useEffect(() => {
    if (!loggedIn) return;

    let retryCount = 0;
    const MAX_RETRY = 10;

    const initMap = () => {
      try {
        console.log(`🗺️ 지도 객체 생성 시도... (${retryCount + 1}/${MAX_RETRY})`);

        const container = document.getElementById("map");
        if (!container) {
          console.warn("⚠️ 지도 DOM이 아직 존재하지 않음. 300ms 후 재시도");
          retryCount++;
          if (retryCount < MAX_RETRY) setTimeout(initMap, 300);
          return;
        }

        if (!window.kakao || !window.kakao.maps) {
          console.warn("⚠️ Kakao SDK 아직 로드 안됨. 재시도...");
          retryCount++;
          if (retryCount < MAX_RETRY) setTimeout(initMap, 300);
          return;
        }

        console.log("🧭 Kakao.maps.Map 생성 시작");
        const mapInstance = new window.kakao.maps.Map(container, {
          center: new window.kakao.maps.LatLng(37.5665, 126.9780),
          level: 6,
          mapTypeId:
            mapType === "SKYVIEW"
              ? window.kakao.maps.MapTypeId.HYBRID
              : window.kakao.maps.MapTypeId.ROADMAP,
        });

        // ✅ 내 위치로 이동
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
            (err) => console.warn("⚠️ 위치 가져오기 실패:", err.message)
          );
        }

        setMap(mapInstance);
        console.log("✅ 지도 객체 초기화 완료");
      } catch (err) {
        console.error("🔥 지도 초기화 중 예외:", err);
        retryCount++;
        if (retryCount < MAX_RETRY) setTimeout(initMap, 300);
      }
    };

    const loadKakaoScript = () => {
      if (document.getElementById("kakao-sdk")) {
        console.log("📦 Kakao SDK 이미 존재 → load() 실행");
        window.kakao.maps.load(initMap);
        return;
      }

      console.log("📦 Kakao SDK 로드 시작...");
      const script = document.createElement("script");
      script.id = "kakao-sdk";
      script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_KEY}&autoload=false&libraries=services`;
      script.onload = () => {
        console.log("📦 Kakao SDK 로드 완료 → load() 실행");
        window.kakao.maps.load(initMap);
      };
      script.onerror = (e) => {
        console.error("❌ Kakao SDK 로드 실패:", e);
        retryCount++;
        if (retryCount < MAX_RETRY) setTimeout(loadKakaoScript, 500);
      };
      document.head.appendChild(script);
    };

    loadKakaoScript();
  }, [loggedIn]);

  /* 📍 내 위치 마커 표시 */
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

  /* 🗺️ 지도 타입 전환 */
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
    console.log("🔄 지도 타입 변경:", nextType);
  };

  /* ✅ 로그인 전 UI */
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

  /* ✅ 지도 UI */
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
