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
  let markers = []; // 지도에 표시된 마커 및 오버레이 저장

  // ✅ 로그인 처리
  const handleLogin = async (e) => {
    e.preventDefault();
    const { data: users, error } = await supabase.from("users").select("*").eq("id", user);
    if (error) return alert("Supabase 오류: " + error.message);
    if (users && users.length > 0 && users[0].password === password) {
      await loadExcel(users[0].data_file);
      setLoggedIn(true);
    } else alert("로그인 실패: 아이디 또는 비밀번호 확인");
  };

  // ✅ Excel 로드
  const loadExcel = async (fileName) => {
    try {
      const { data, error } = await supabase.storage.from("excels").download(fileName);
      if (error) throw error;
      const blob = await data.arrayBuffer();
      const workbook = XLSX.read(blob, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(sheet);
      setData(
        json.map((row) => ({
          계기번호: row["계기번호"],
          주소: row["주소"],
          진행: row["진행"] || "미방문",
        }))
      );
    } catch (err) {
      alert("엑셀 로드 실패: " + err.message);
    }
  };

  // ✅ Kakao 지도 로드
  useEffect(() => {
    if (!loggedIn) return;
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
        setMap(mapInstance);
      });
    };
    document.head.appendChild(script);
  }, [loggedIn]);

  // ✅ 지도 마커 렌더링 (React 상태 변화 감지)
  useEffect(() => {
    if (!map || data.length === 0) return;
    renderMarkers();
  }, [map, data]);

  // ✅ 지도에 마커 표시 함수
  const renderMarkers = () => {
    // 기존 마커 및 오버레이 제거
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

    Object.keys(grouped).forEach((addr) => {
      geocoder.addressSearch(addr, (result, status) => {
        if (status !== window.kakao.maps.services.Status.OK) return;
        const coords = new window.kakao.maps.LatLng(result[0].y, result[0].x);
        const group = grouped[addr];
        const 진행 = group[0].진행;
        const color = 진행 === "완료" ? "green" : 진행 === "불가" ? "red" : "blue";

        // 마커 생성
        const marker = new window.kakao.maps.Marker({ position: coords, map });
        markers.push(marker);

        // 숫자 표시용 CustomOverlay
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

          // 버튼 클릭 이벤트
          popupEl.querySelector("#doneBtn").addEventListener("click", (e) => {
            e.stopPropagation();
            updateStatus(addr, "완료");
          });
          popupEl.querySelector("#failBtn").addEventListener("click", (e) => {
            e.stopPropagation();
            updateStatus(addr, "불가");
          });
          popupEl.querySelector("#todoBtn").addEventListener("click", (e) => {
            e.stopPropagation();
            updateStatus(addr, "미방문");
          });
        };

        // 클릭 이벤트 등록
        overlayEl.addEventListener("click", (e) => {
          e.stopPropagation();
          showPopup();
        });
        window.kakao.maps.event.addListener(marker, "click", showPopup);
      });
    });

    // 지도 클릭 시 팝업 닫기
    window.kakao.maps.event.addListener(map, "click", () => {
      if (activeOverlay) {
        activeOverlay.setMap(null);
        activeOverlay = null;
      }
    });
  };

  // ✅ 상태 업데이트 (지도 리렌더링 포함)
  const updateStatus = async (addr, status) => {
    const updated = data.map((d) =>
      d.주소 === addr ? { ...d, 진행: status } : d
    );
    setData(updated); // 상태 변경 → 자동 리렌더링
    await supabase.from("meters").upsert(updated);
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
