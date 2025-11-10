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
  const [currentUser, setCurrentUser] = useState(null);
  const [counts, setCounts] = useState({ 완료: 0, 불가: 0, 미방문: 0 });
  const [mapType, setMapType] = useState("ROADMAP");

  let activeOverlay = null;
  let markers = [];
  const geoCache = JSON.parse(localStorage.getItem("geoCache") || "{}");

  /** 🔐 로그인 처리 **/
  const handleLogin = async (e) => {
    e.preventDefault();
    console.log("[DEBUG][LOGIN] 로그인 시도:", user);

    const { data: users, error } = await supabase
      .from("users")
      .select("*")
      .eq("id", user);

    if (error) {
      console.error("[ERROR][LOGIN] Supabase 오류:", error.message);
      return alert("로그인 오류 발생");
    }

    if (users && users.length > 0 && users[0].password === password) {
      const userData = users[0];
      console.log("[DEBUG][LOGIN] ✅ 로그인 성공:", userData);
      console.log("[DEBUG][LOGIN] 관리자 여부:", userData.can_view_others);
      setCurrentUser(userData);
      await loadData(userData.data_file);
      setLoggedIn(true);
    } else {
      alert("로그인 실패");
    }
  };

  /** 📄 Excel 데이터 로드 **/
  const loadData = async (fileName) => {
    try {
      console.log("[DEBUG][DATA] 📂 엑셀 로드 시작:", fileName);
      const { data: excelBlob, error } = await supabase.storage
        .from("excels")
        .download(fileName);
      if (error) throw error;

      const blob = await excelBlob.arrayBuffer();
      const workbook = XLSX.read(blob, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(sheet);
      console.log("[DEBUG][DATA] 📊 엑셀 데이터:", json.length, "행");

      const baseData = json.map((r) => ({
        meter_id: r["계기번호"],
        address: r["주소"],
        status: r["진행"] || "미방문",
      }));

      const { data: dbData } = await supabase.from("meters").select("*");
      const merged = baseData.map((x) => {
        const m = dbData?.find(
          (d) => d.meter_id === x.meter_id && d.address === x.address
        );
        return m ? { ...x, status: m.status } : x;
      });
      setData(merged);
      console.log("[DEBUG][DATA] ✅ 병합 완료:", merged.length);
    } catch (e) {
      console.error("[ERROR][DATA] 엑셀 로드 실패:", e.message);
    }
  };

  /** 🗺️ Kakao 지도 초기화 **/
  useEffect(() => {
    if (!loggedIn) return;
    console.log("[DEBUG][MAP] Kakao 지도 SDK 로드 중...");
    const script = document.createElement("script");
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_KEY}&autoload=false&libraries=services`;
    script.onload = () => {
      console.log("[DEBUG][MAP] ✅ Kakao SDK 로드 완료");
      window.kakao.maps.load(() => {
        const mapContainer = document.getElementById("map");
        const mapInstance = new window.kakao.maps.Map(mapContainer, {
          center: new window.kakao.maps.LatLng(37.5665, 126.9780),
          level: 5,
        });
        setMap(mapInstance);
        console.log("[DEBUG][MAP] ✅ 지도 객체 생성 완료");
      });
    };
    document.head.appendChild(script);
  }, [loggedIn]);

  /** 📍 내 위치 마커 표시 **/
  useEffect(() => {
    if (!map || !currentUser) return;
    console.log("[DEBUG][GEO] 내 위치 탐색 시작...");

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          console.log("[DEBUG][GEO] ✅ 내 위치 감지:", lat, lng);

          const locPosition = new window.kakao.maps.LatLng(lat, lng);
          map.setCenter(locPosition);

          const markerEl = document.createElement("div");
          markerEl.style.cssText = `
            background:#007bff;
            border-radius:8px;
            color:white;
            font-weight:bold;
            padding:6px 10px;
            font-size:13px;
            border:2px solid white;
            box-shadow:0 0 6px rgba(0,0,0,0.4);
          `;
          markerEl.textContent = currentUser.id;

          const overlay = new window.kakao.maps.CustomOverlay({
            position: locPosition,
            content: markerEl,
            yAnchor: 1,
          });
          overlay.setMap(map);
          console.log("[DEBUG][GEO] 👤 내 위치 마커 표시 완료");
        },
        (err) => console.warn("[DEBUG][GEO] ⚠️ 위치 감지 실패:", err.message)
      );
    }
  }, [map, currentUser]);

  /** 🗺️ 지도 타입 전환 **/
  const toggleMapType = () => {
    if (!map) return;
    const newType = mapType === "ROADMAP" ? "HYBRID" : "ROADMAP";
    map.setMapTypeId(
      newType === "ROADMAP"
        ? window.kakao.maps.MapTypeId.ROADMAP
        : window.kakao.maps.MapTypeId.HYBRID
    );
    console.log(`[DEBUG][MAP] 지도 타입 전환 → ${newType}`);
    setMapType(newType);
  };

  /** 🌐 주소 → 좌표 변환 (캐시 포함) **/
  const geocodeAddress = (geocoder, address) =>
    new Promise((resolve) => {
      if (geoCache[address]) {
        console.log(`[DEBUG][GEO] 💾 캐시 HIT: ${address}`);
        return resolve(geoCache[address]);
      }
      geocoder.addressSearch(address, (result, status) => {
        if (status === window.kakao.maps.services.Status.OK) {
          const lat = parseFloat(result[0].y).toFixed(5);
          const lng = parseFloat(result[0].x).toFixed(5);
          geoCache[address] = { lat, lng };
          localStorage.setItem("geoCache", JSON.stringify(geoCache));
          console.log(`[DEBUG][GEO] Geocode 성공: ${address} → (${lat}, ${lng})`);
          resolve({ lat, lng });
        } else {
          console.warn(`[DEBUG][GEO] ⚠️ 지오코딩 실패: ${address}`);
          resolve(null);
        }
      });
    });

  /** 🧭 데이터 렌더링 **/
  useEffect(() => {
    if (!map || data.length === 0) return;
    console.log("[DEBUG][MAP] 지도 렌더링 시작...");
    renderMarkers();
  }, [map, data]);

  /** 📍 마커 렌더링 및 팝업 **/
  const renderMarkers = async () => {
    try {
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

      Object.keys(grouped).forEach((key) => {
        const { coords, list } = grouped[key];
        const 진행 = list[0].status;
        const color =
          진행 === "완료" ? "green" : 진행 === "불가" ? "red" : "blue";
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

        /** 💬 마커 클릭 시 팝업 **/
        const openPopup = (e) => {
          e.stopPropagation();
          if (activeOverlay) activeOverlay.setMap(null);

          const popupEl = document.createElement("div");
          popupEl.style.cssText = `
            background:white;
            padding:10px;
            border:1px solid #ccc;
            border-radius:8px;
            width:230px;
            box-shadow:0 2px 8px rgba(0,0,0,0.2);
          `;

          ["mousedown", "click", "touchstart"].forEach((ev) =>
            popupEl.addEventListener(ev, (e) => e.stopPropagation())
          );

          const title = document.createElement("b");
          title.textContent = list[0].address;
          popupEl.appendChild(title);
          popupEl.appendChild(document.createElement("br"));
          popupEl.appendChild(document.createElement("br"));

          // 계기번호 중복 처리
          const last2 = list.map((g) => g.meter_id.slice(-2));
          const duplicates = last2.filter((x, i) => last2.indexOf(x) !== i);
          list.forEach((g) => {
            const div = document.createElement("div");
            div.textContent = g.meter_id;
            if (duplicates.includes(g.meter_id.slice(-2))) div.style.color = "red";
            popupEl.appendChild(div);
          });

          popupEl.appendChild(document.createElement("hr"));

          // ✅ 버튼 (완료/불가/미방문/가기)
          const buttons = ["완료", "불가", "미방문", "가기"];
          buttons.forEach((text) => {
            const btn = document.createElement("button");
            btn.textContent = text;
            btn.type = "button";
            btn.style.margin = "4px 5px";
            btn.style.padding = "5px 8px";
            btn.style.borderRadius = "6px";
            btn.style.border = "1px solid #ccc";
            btn.style.background = "#f0f0f0";

            ["mousedown", "click", "touchstart"].forEach((ev) =>
              btn.addEventListener(ev, (e) => e.stopPropagation())
            );

            btn.addEventListener("click", async (e) => {
              e.stopPropagation();
              if (text === "가기") {
                const url = `https://map.kakao.com/link/to/${encodeURIComponent(
                  list[0].address
                )},${coords.lat},${coords.lng}`;
                console.log("[DEBUG][NAV] 내비 실행:", url);
                window.open(url, "_blank");
              } else {
                console.log(`[DEBUG][STATUS] ${text} 클릭됨`);
                await updateStatus(list.map((g) => g.meter_id), text, coords);
              }
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
        };

        markerEl.addEventListener("click", openPopup);
        markerEl.addEventListener("touchstart", openPopup);
      });

      window.kakao.maps.event.addListener(map, "click", () => {
        if (activeOverlay) activeOverlay.setMap(null);
      });
    } catch (e) {
      console.error("[ERROR][MAP] 마커 렌더링 실패:", e);
    }
  };

  /** 🔄 상태 업데이트 (Supabase 반영 + UI 즉시 갱신) **/
  const updateStatus = async (meterIds, newStatus, coords) => {
    try {
      console.log("[DEBUG][STATUS] 🛠️ 상태 업데이트 시도:", meterIds, "→", newStatus);

      const updated = data.map((d) =>
        meterIds.includes(d.meter_id) ? { ...d, status: newStatus } : d
      );
      setData(updated);

      const payload = updated
        .filter((d) => meterIds.includes(d.meter_id))
        .map((d) => ({
          meter_id: d.meter_id,
          address: d.address,
          status: newStatus,
          user_id: currentUser.id,
          lat: parseFloat(coords.lat),
          lng: parseFloat(coords.lng),
        }));

      const { error } = await supabase.from("meters").upsert(payload, {
        onConflict: ["meter_id", "address"],
      });

      if (error) throw error;
      console.log("[DEBUG][STATUS] ✅ Supabase 업데이트 완료:", payload);

      // 지도 최신화 반영
      renderMarkers();
    } catch (e) {
      console.error("[ERROR][STATUS] 저장 실패:", e.message);
    }
  };

  /** 👑 관리자 모드 — 일반 계정들의 마지막 위치 표시 **/
  useEffect(() => {
    if (!map || !currentUser) return;

    const isAdmin =
      currentUser.can_view_others === true || currentUser.can_view_others === "y";
    if (!isAdmin) return;

    console.log("[DEBUG][ADMIN] 👑 관리자 계정 — 일반 계정 위치 로드 중...");

    const loadOtherUserLocations = async () => {
      try {
        const { data: logs, error } = await supabase
          .from("meters")
          .select("address, lat, lng, status, user_id, updated_at")
          .not("user_id", "is", null);
        if (error) throw error;
        console.log(`[DEBUG][ADMIN] 📦 ${logs.length}개 작업 로그 로드 완료`);

        const latest = {};
        logs.forEach((l) => {
          if (!l.user_id || !l.lat || !l.lng) return;
          latest[l.user_id] = l;
        });

        Object.keys(latest).forEach((uid) => {
          const loc = latest[uid];
          const coord = new window.kakao.maps.LatLng(loc.lat, loc.lng);

          const markerEl = document.createElement("div");
          markerEl.style.cssText = `
            background:purple;
            border-radius:8px;
            padding:4px 7px;
            color:white;
            font-weight:bold;
            font-size:11px;
            box-shadow:0 0 6px rgba(0,0,0,0.4);
            cursor:pointer;
          `;
          markerEl.textContent = uid;

          const overlay = new window.kakao.maps.CustomOverlay({
            position: coord,
            content: markerEl,
            yAnchor: 1,
          });
          overlay.setMap(map);

          const openPopup = (e) => {
            e.stopPropagation();
            console.log(`[DEBUG][ADMIN] ${uid} 팝업 표시`);
            const popup = document.createElement("div");
            popup.style.cssText = `
              background:white;
              padding:8px;
              border-radius:8px;
              border:1px solid #ccc;
              width:230px;
              box-shadow:0 2px 6px rgba(0,0,0,0.3);
            `;
            popup.innerHTML = `
              <div><b>사용자:</b> ${uid}</div>
              <div><b>상태:</b> ${loc.status}</div>
              <div><b>주소:</b> ${loc.address}</div>
            `;

            const goBtn = document.createElement("button");
            goBtn.textContent = "가기";
            goBtn.style.marginTop = "6px";
            goBtn.style.padding = "5px 8px";
            goBtn.style.borderRadius = "6px";
            goBtn.style.border = "1px solid #ccc";
            goBtn.style.cursor = "pointer";

            goBtn.addEventListener("click", (e) => {
              e.stopPropagation();
              const navUrl = `https://map.kakao.com/link/to/${encodeURIComponent(
                loc.address
              )},${loc.lat},${loc.lng}`;
              console.log("[DEBUG][ADMIN] 🧭 내비 실행:", navUrl);
              window.open(navUrl, "_blank");
            });

            popup.appendChild(goBtn);
            const pop = new window.kakao.maps.CustomOverlay({
              position: coord,
              content: popup,
              yAnchor: 1.4,
              zIndex: 99999,
            });
            pop.setMap(map);
            setTimeout(() => pop.setMap(null), 6000);
          };

          markerEl.addEventListener("click", openPopup);
          markerEl.addEventListener("touchstart", openPopup);
        });

        console.log("[DEBUG][ADMIN] ✅ 일반 계정 마지막 위치 표시 완료");
      } catch (e) {
        console.error("[ERROR][ADMIN] 관리자 위치 표시 실패:", e);
      }
    };

    loadOtherUserLocations();
  }, [map, currentUser, data]);

  /** 🧭 UI 및 렌더링 **/
  if (!loggedIn)
    return (
      <div style={{ textAlign: "center", marginTop: "100px" }}>
        <h2>로그인</h2>
        <form onSubmit={handleLogin}>
          <input
            value={user}
            onChange={(e) => setUser(e.target.value)}
            placeholder="아이디"
          />
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
      {/* 🟩 상단 카운터 */}
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

      {/* 🗺️ 지도 타입 버튼 */}
      <button
        onClick={toggleMapType}
        style={{
          position: "absolute",
          bottom: 20,
          left: 20,
          zIndex: 99999,
          padding: "10px 14px",
          borderRadius: "8px",
          border: "none",
          background: "#333",
          color: "white",
          cursor: "pointer",
          boxShadow: "0 2px 5px rgba(0,0,0,0.3)",
        }}
      >
        🗺️ 지도 전환 ({mapType === "ROADMAP" ? "스카이뷰" : "일반"})
      </button>

      {/* 👑 관리자 배지 */}
      {(currentUser?.can_view_others === true ||
        currentUser?.can_view_others === "y") && (
        <div
          style={{
            position: "absolute",
            bottom: 20,
            right: 20,
            zIndex: 99999,
            background: "rgba(128,0,128,0.8)",
            color: "white",
            padding: "8px 12px",
            borderRadius: "8px",
            fontWeight: "bold",
            fontSize: "14px",
            boxShadow: "0 2px 6px rgba(0,0,0,0.3)",
          }}
        >
          👑 관리자 모드
        </div>
      )}

      {/* 🗺️ 지도 본체 */}
      <div id="map" style={{ width: "100%", height: "100vh" }}></div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
