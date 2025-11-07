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
  const [userPosition, setUserPosition] = useState(null);

  const activeOverlay = useRef(null);
  const markers = useRef([]);
  const geoCache = JSON.parse(localStorage.getItem("geoCache") || "{}");

  // ✅ 로그인
  const handleLogin = async (e) => {
    e.preventDefault();
    console.log("🔐 로그인 시도:", user);
    const { data: users, error } = await supabase.from("users").select("*").eq("id", user);
    if (error) return console.error("❌ Supabase 오류:", error.message);
    if (users?.length && users[0].password === password) {
      console.log("✅ 로그인 성공:", users[0]);
      setDataFile(users[0].data_file);
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
    }));

    const { data: dbData } = await supabase.from("meters").select("*");
    const merged = baseData.map((x) => {
      const match = dbData?.find(
        (d) => d.meter_id === x.meter_id && d.address === x.address
      );
      return match ? { ...x, status: match.status } : x;
    });

    console.log("✅ 데이터 병합 완료:", merged.length);
    setData(merged);
  };

  // ✅ DB 최신 상태만 불러오기
  const loadDataFromDB = async () => {
    console.log("🔄 DB로부터 최신 상태 불러오기...");
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

  // ✅ Kakao 지도 로드
  useEffect(() => {
    if (!loggedIn) return;
    const script = document.createElement("script");
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_KEY}&autoload=false&libraries=services`;
    script.onload = () => {
      window.kakao.maps.load(() => {
        const mapInstance = new window.kakao.maps.Map(document.getElementById("map"), {
          center: new window.kakao.maps.LatLng(37.5665, 126.9780),
          level: 6,
        });
        console.log("✅ Kakao 지도 초기화 완료");
        setMap(mapInstance);
      });
    };
    document.head.appendChild(script);
  }, [loggedIn]);

  // ✅ GPS 위치 추적
  useEffect(() => {
    if (!map) return;
    if (!navigator.geolocation) {
      console.warn("⚠️ 이 브라우저는 위치 정보를 지원하지 않습니다.");
      return;
    }

    const updateLocation = (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      setUserPosition({ lat, lng });

      if (!window.myLocationMarker) {
        const marker = new window.kakao.maps.Marker({
          position: new window.kakao.maps.LatLng(lat, lng),
          map: map,
          title: "내 위치",
        });
        window.myLocationMarker = marker;
      } else {
        window.myLocationMarker.setPosition(new window.kakao.maps.LatLng(lat, lng));
      }
    };

    navigator.geolocation.watchPosition(updateLocation, (err) => {
      console.error("❌ 위치 추적 오류:", err.message);
    });
  }, [map]);

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

        // ✅ 마커 클릭 시 DB 최신화 실행
        console.log("🧭 마커 클릭 → DB 새로고침 실행");
        await loadDataFromDB();

        // ✅ 기존 팝업 닫기
        if (activeOverlay.current) activeOverlay.current.setMap(null);

        // ✅ 새 팝업 표시
        const popupEl = document.createElement("div");
        popupEl.style.cssText = `
          background:white;
          padding:10px;
          border:1px solid #ccc;
          border-radius:8px;
        `;
        popupEl.addEventListener("mousedown", (e) => e.stopPropagation());
        popupEl.addEventListener("touchstart", (e) => e.stopPropagation());
        popupEl.addEventListener("click", (e) => e.stopPropagation());

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
          btn.addEventListener("mousedown", (e) => e.stopPropagation());
          btn.addEventListener("click", async (e) => {
            e.stopPropagation();
            console.log(`🔘 ${text} 버튼 클릭`);
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

    // ✅ 지도 클릭 → 팝업 닫기만
    window.kakao.maps.event.addListener(map, "click", () => {
      if (activeOverlay.current) activeOverlay.current.setMap(null);
    });
  };

  // ✅ Supabase 상태 업데이트
  const updateStatus = async (meterIds, newStatus) => {
    const updated = data.map((d) =>
      meterIds.includes(d.meter_id) ? { ...d, status: newStatus } : d
    );
    setData(updated);
    const payload = updated.filter((d) => meterIds.includes(d.meter_id));
    await supabase.from("meters").upsert(payload, { onConflict: ["meter_id", "address"] });
    console.log("✅ Supabase 저장 완료");
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
      </div>
      <div id="map" style={{ width: "100%", height: "100vh" }}></div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
