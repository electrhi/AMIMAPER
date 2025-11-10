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
  const activeOverlay = useRef(null);
  const markers = useRef([]);

  const handleLogin = async (e) => {
    e.preventDefault();
    const { data: users } = await supabase.from("users").select("*").eq("id", user);
    if (users?.length && users[0].password === password) {
      setCanViewOthers(!!users[0].can_view_others);
      await loadData(users[0].data_file);
      setLoggedIn(true);
    } else alert("로그인 실패");
  };

  const loadData = async (fileName) => {
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

  useEffect(() => {
    if (!loggedIn) return;
    const script = document.createElement("script");
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_KEY}&autoload=false&libraries=services`;
    script.onload = () => {
      window.kakao.maps.load(() => {
        const mapInstance = new window.kakao.maps.Map(document.getElementById("map"), {
          center: new window.kakao.maps.LatLng(36.35, 127.38),
          level: 5,
          mapTypeId:
            mapType === "SKYVIEW"
              ? window.kakao.maps.MapTypeId.HYBRID
              : window.kakao.maps.MapTypeId.ROADMAP,
        });
        setMap(mapInstance);

        window.kakao.maps.event.addListener(mapInstance, "click", () => {
          if (activeOverlay.current) {
            activeOverlay.current.setMap(null);
            activeOverlay.current = null;
          }
        });

        if (navigator.geolocation) {
          navigator.geolocation.getCurrentPosition((pos) => {
            const loc = new window.kakao.maps.LatLng(pos.coords.latitude, pos.coords.longitude);
            mapInstance.setCenter(loc);
          });
        }
      });
    };
    document.head.appendChild(script);
  }, [loggedIn]);

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

      markerEl.addEventListener("click", (e) => {
        e.stopPropagation();
        openPopup(list, kakaoCoord);
      });
    });
  };

  const openPopup = (list, kakaoCoord) => {
    if (activeOverlay.current) activeOverlay.current.setMap(null);

    const popupEl = document.createElement("div");
    popupEl.style.cssText =
      "background:white;padding:10px;border:1px solid #ccc;border-radius:8px;max-width:230px;";
    popupEl.innerHTML = `<b>${list[0].address}</b><br/>`;

    // ✅ 계기번호 중복 처리
    const suffixSet = new Set();
    list.forEach((g) => suffixSet.add(g.meter_id.slice(-2)));
    const duplicates = [...suffixSet].filter(
      (s) => list.filter((g) => g.meter_id.slice(-2) === s).length > 1
    );

    list.forEach((g) => {
      const suffix = g.meter_id.slice(-2);
      const color = duplicates.includes(suffix) ? "red" : "black";
      const div = document.createElement("div");
      div.innerHTML = `계기번호: <span style="color:${color}">${g.meter_id}</span>`;
      popupEl.appendChild(div);
    });

    popupEl.appendChild(document.createElement("hr"));

    // ✅ 상태 버튼
    ["완료", "불가", "미방문"].forEach((text) => {
      const btn = document.createElement("button");
      btn.textContent = text;
      btn.style.marginRight = "5px";
      btn.onclick = async (e) => {
        e.stopPropagation();
        await updateStatus(list.map((g) => g.meter_id), text);
      };
      popupEl.appendChild(btn);
    });

    // ✅ “가기” 버튼 (카카오내비)
    const naviBtn = document.createElement("button");
    naviBtn.textContent = "🧭 가기";
    naviBtn.style.marginTop = "8px";
    naviBtn.onclick = () => {
      const lat = kakaoCoord.getLat();
      const lng = kakaoCoord.getLng();
      if (window.Kakao && window.Kakao.Navi) {
        window.Kakao.init(KAKAO_KEY);
        window.Kakao.Navi.start({
          name: list[0].address,
          x: lng,
          y: lat,
          coordType: "wgs84",
        });
      } else {
        window.open(
          `https://map.kakao.com/link/to/${encodeURIComponent(list[0].address)},${lat},${lng}`
        );
      }
    };
    popupEl.appendChild(naviBtn);

    // ✅ 관리자 표시
    if (canViewOthers && list[0].owner_id) {
      popupEl.innerHTML += `<hr/>📌 담당자: ${list[0].owner_id}<br/>🕒 ${new Date().toLocaleString()}`;
    }

    const popupOverlay = new window.kakao.maps.CustomOverlay({
      position: kakaoCoord,
      content: popupEl,
      yAnchor: 1.5,
      zIndex: 10000,
    });
    popupOverlay.setMap(map);
    activeOverlay.current = popupOverlay;
  };

  const updateStatus = async (meterIds, newStatus) => {
    const updated = data.map((d) =>
      meterIds.includes(d.meter_id)
        ? { ...d, status: newStatus, owner_id: user }
        : d
    );
    setData(updated);
    await supabase.from("meters").upsert(updated, { onConflict: ["meter_id", "address"] });
    renderMarkers(); // ✅ 즉시 지도 갱신
  };

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
        {canViewOthers && (
          <span style={{ marginLeft: "10px", color: "#ff7f00" }}>🧭 관리자모드</span>
        )}
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
