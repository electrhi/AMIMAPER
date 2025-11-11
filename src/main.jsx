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
  const [currentUser, setCurrentUser] = useState(null);
  const [counts, setCounts] = useState({ 완료: 0, 불가: 0, 미방문: 0 });
  const [mapType, setMapType] = useState("ROADMAP");
  
  const otherUserOverlays = useRef([]); // ✅ 기존 let otherUserOverlays = [] 대신

  let activeOverlay = null;
  let markers = [];
  // ✅ Supabase 기반 캐시 저장용
  const [geoCache, setGeoCache] = useState({});
  const GEO_CACHE_FILE = `geoCache_${currentUser?.data_file || "default"}.json`;


  // ✅ 추가: 팝업 닫기 최신 참조 관리용
  const getActiveOverlay = () => window.__activeOverlayRef || null;
  const setActiveOverlay = (ov) => (window.__activeOverlayRef = ov);

  /** 로그인 처리 **/
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
      console.warn("[DEBUG][LOGIN] ❌ 로그인 실패");
      alert("로그인 실패");
    }
  };

/** Excel 데이터 로드 **/
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

    // ✅ 수정 시작: 최신 데이터만 유지
    const { data: dbData } = await supabase
      .from("meters")
      .select("*")
      .order("updated_at", { ascending: false });

    const latestMap = {};
    dbData?.forEach((d) => {
      if (!latestMap[d.meter_id]) latestMap[d.meter_id] = d;
    });
    const latestData = Object.values(latestMap);

    const merged = baseData.map((x) => {
      const m = latestData.find(
        (d) => d.meter_id === x.meter_id && d.address === x.address
      );
      return m ? { ...x, status: m.status } : x;
    });
    // ✅ 수정 끝

    setData(merged);
    console.log("[DEBUG][DATA] ✅ 병합 완료:", merged.length);

    // ✅ 추가: 로그인 시 자동 지도 렌더링
    setTimeout(() => renderMarkers(), 400);
  } catch (e) {
    console.error("[ERROR][DATA] 엑셀 로드 실패:", e.message);
  }
};


  /** Kakao 지도 초기화 **/
  useEffect(() => {
    if (!loggedIn) return;
    console.log("[DEBUG][MAP] 🗺️ Kakao 지도 스크립트 로드 시작...");
    const script = document.createElement("script");
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_KEY}&autoload=false&libraries=services`;
    script.onload = () => {
      console.log("[DEBUG][MAP] ✅ Kakao SDK 로드 완료");
      window.kakao.maps.load(() => {
        const mapContainer = document.getElementById("map");
        const mapOption = {
          center: new window.kakao.maps.LatLng(37.5665, 126.9780),
          level: 5,
        };
        const mapInstance = new window.kakao.maps.Map(mapContainer, mapOption);
        setMap(mapInstance);
        console.log("[DEBUG][MAP] ✅ 지도 객체 생성 완료:", mapInstance);
      });
    };
    document.head.appendChild(script);
  }, [loggedIn]);

  /** ✅ Supabase에서 geoCache 파일 로드 **/
useEffect(() => {
  if (!loggedIn || !currentUser) return;

  const loadGeoCache = async () => {
    try {
      console.log(`[DEBUG][CACHE] 📦 캐시 불러오기 시도: ${GEO_CACHE_FILE}`);
      const { data: cacheBlob, error } = await supabase.storage
        .from("excels")
        .download(GEO_CACHE_FILE);

      if (error) {
        console.warn("[DEBUG][CACHE] ❌ 캐시 없음 — 새로 생성 예정");
        setGeoCache({});
        return;
      }

      const text = await cacheBlob.text();
      const parsed = JSON.parse(text);
      console.log(`[DEBUG][CACHE] ✅ 캐시 ${Object.keys(parsed).length}개 로드 완료`);
      setGeoCache(parsed);
    } catch (err) {
      console.error("[ERROR][CACHE] 캐시 로드 실패:", err.message);
    }
  };

    loadGeoCache();

  // ✅ 캐시 로드 후 마커 렌더링 약간 지연 실행
  setTimeout(() => renderMarkers(), 800);

}, [loggedIn, currentUser]);

  /** 내 위치 마커 표시 **/
  useEffect(() => {
    if (!map || !currentUser) return;
    console.log("[DEBUG][GEO] 📍 내 위치 탐색 시작...");

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
        (err) => console.warn("[DEBUG][GEO] ⚠️ 위치 불러오기 실패:", err.message)
      );
    } else {
      console.warn("[DEBUG][GEO] ❌ 위치 추적 지원 안함");
    }
  }, [map, currentUser]);

  /** 지도 타입 전환 **/
  const toggleMapType = () => {
    if (!map) return;
    const newType = mapType === "ROADMAP" ? "HYBRID" : "ROADMAP";
    map.setMapTypeId(
      newType === "ROADMAP"
        ? window.kakao.maps.MapTypeId.ROADMAP
        : window.kakao.maps.MapTypeId.HYBRID
    );
    console.log(`[DEBUG][MAP] 🗺️ 지도 타입 전환 → ${newType}`);
    setMapType(newType);
  };

  /** 주소 → 좌표 변환 **/
  /** ✅ 주소 → 좌표 변환 + Supabase 캐시 업로드 **/
const geocodeAddress = (geocoder, address) =>
  new Promise(async (resolve) => {
    if (geoCache[address]) {
      console.log(`[DEBUG][GEO] 💾 캐시 HIT: ${address}`);
      return resolve(geoCache[address]);
    }

    // 👇 여기에 추가
if (!address || address.trim() === "") {
  console.warn("[WARN][GEO] 주소가 비어있음 → 스킵");
  return resolve(null);
}

    // 실제 Kakao API 호출
    geocoder.addressSearch(address, async (result, status) => {
      if (status === window.kakao.maps.services.Status.OK) {
        const lat = parseFloat(result[0].y).toFixed(5);
        const lng = parseFloat(result[0].x).toFixed(5);

        const newCache = { ...geoCache, [address]: { lat, lng } };
        setGeoCache(newCache);

        console.log(`[DEBUG][GEO] 🌐 Geocode 성공: ${address} → (${lat}, ${lng})`);

        // ✅ Supabase에 캐시 업로드
        try {
          const { error: upError } = await supabase.storage
            .from("excels")
            .upload(GEO_CACHE_FILE, JSON.stringify(newCache), {
              upsert: true,
              contentType: "application/json",
            });

          if (upError) console.warn("[WARN][CACHE] 캐시 업로드 실패:", upError.message);
          else console.log(`[DEBUG][CACHE] 💾 ${GEO_CACHE_FILE} 업로드 완료`);
        } catch (e) {
          console.error("[ERROR][CACHE] 업로드 실패:", e.message);
        }

        resolve({ lat, lng });
      } else {
        console.warn(`[DEBUG][GEO] ⚠️ 지오코딩 실패: ${address} (${status})`);
        resolve(null);
      }
    });
  });

  /** 데이터 변경 시 지도 렌더링 **/
  useEffect(() => {
  if (!map || data.length === 0) return;

  const waitForKakaoEvent = setInterval(() => {
    if (window.kakao?.maps?.event) {
      clearInterval(waitForKakaoEvent);
      console.log("[DEBUG][MAP] 🧭 지도 렌더링 시작 (이벤트 모듈 확인 완료)");
      renderMarkers();
    } else {
      console.log("[DEBUG][MAP] ⏳ kakao.maps.event 로딩 대기 중...");
    }
  }, 300);

  return () => clearInterval(waitForKakaoEvent);
}, [map, data]);


/** 마커 렌더링 **/
const renderMarkers = async () => {
  try {
    const failedAddresses = []; // ✅ 실패한 주소 담는 배열
    markers.forEach((m) => m.setMap(null));
    markers = [];
    activeOverlay = null;

    const geocoder = new window.kakao.maps.services.Geocoder();
    const grouped = {};
    const statusCount = { 완료: 0, 불가: 0, 미방문: 0 };

    // ✅ 추가: meter_id별 최신 1개만 표시
    const latestPerMeter = {};
    data.forEach((d) => {
      statusCount[d.status] = (statusCount[d.status] || 0) + 1;
      if (!latestPerMeter[d.meter_id]) latestPerMeter[d.meter_id] = d;
    });
    const filteredData = Object.values(latestPerMeter);
    setCounts(statusCount);
    console.log("[DEBUG][MAP] 🔄 상태 카운트:", statusCount);

// ✅ 중복 제거용 Set 생성
const uniqueGroupSet = new Set();

for (const row of filteredData) {
  const addrKey = row.address?.trim().replace(/\s+/g, " ");
  let coords = geoCache[addrKey];

  // ✅ 캐시에 없으면 API 재시도
  if (!coords) {
    console.warn(`[WARN][MAP] 캐시에 없음 → API 재시도: ${addrKey}`);
    coords = await geocodeAddress(new window.kakao.maps.services.Geocoder(), addrKey);
  }

  // ✅ 여전히 좌표가 없으면 실패 리스트에 추가하고 건너뜀
  if (!coords || !coords.lat || !coords.lng) {
    failedAddresses.push(addrKey);
    continue;
  }

  const key = `${coords.lat},${coords.lng}`;
  const uniqueKey = `${addrKey}_${row.meter_id}`;
  if (uniqueGroupSet.has(uniqueKey)) continue;
  uniqueGroupSet.add(uniqueKey);

  if (!grouped[key]) grouped[key] = { coords, list: [] };
  grouped[key].list.push(row);
}

// ✅ 모든 데이터 처리 후, 실패 주소 콘솔에 출력
if (failedAddresses.length > 0) {
  console.warn(`[WARN][GEO] ❌ 지오코딩 실패 ${failedAddresses.length}건`);
  console.table(failedAddresses);
}

  // ✅ 중복 방지 키 생성: 주소 + 계기번호 조합
  const uniqueKey = `${row.address}_${row.meter_id}`;
  if (uniqueGroupSet.has(uniqueKey)) continue; // 이미 추가된 경우 skip
  uniqueGroupSet.add(uniqueKey);

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

/** ✅ 계기타입 매핑 **/
const meter_mapping = {
  "17": "E-Type",
  "18": "E-Type",
  "19": "Adv-E",
  "25": "G-Type",
  "26": "G-Type",
  "27": "G-Type",
  "45": "G-Type",
  "46": "G-Type",
  "47": "G-Type",
  "01": "표준형",
  "03": "표준형",
  "14": "표준형",
  "15": "표준형",
  "34": "표준형",
  "35": "표준형",
  "51": "AMIGO",
  "52": "AMIGO",
  "53": "AMIGO",
  "54": "AMIGO",
  "55": "AMIGO",
  "56": "AMIGO",
  "57": "AMIGO",
};

        
/** 📌 마커 클릭 **/
const openPopup = async (e) => {
  e.stopPropagation();

  // ✅ 최신 데이터 반영 (팝업 열기 전)
  const latestData = await fetchLatestStatus();

  const old = getActiveOverlay();
  if (old) old.setMap(null);
  console.log(`[DEBUG][MAP] 🖱️ 마커 클릭됨: ${list[0].address}`);

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

// ✅ 중복 계기번호 감지
const allIds = list.map((g) => g.meter_id);
const duplicates = allIds.filter((id, i) => allIds.indexOf(id) !== i);

// ✅ 중복 제거된 계기번호만 표시
const uniqueMeters = Array.from(new Set(allIds));

uniqueMeters.forEach((id) => {
  const div = document.createElement("div");

  // ✅ 계기번호에서 3~4번째 자리 추출
  const mid = id.substring(2, 4);
  const type = meter_mapping[mid] || "확인필요";

  // ✅ 기본 표시
  div.textContent = `${id} | ${type}`;

  // ✅ 중복 계기번호는 빨간색
  if (duplicates.includes(id)) div.style.color = "red";

  popupEl.appendChild(div);
});

popupEl.appendChild(document.createElement("hr"));



          const buttons = ["완료", "불가", "미방문", "가기"];
          buttons.forEach((text) => {
            const btn = document.createElement("button");
            btn.textContent = text;
            btn.style.margin = "4px";
            btn.addEventListener("click", async (e) => {
              e.stopPropagation();
              if (text === "가기") {
                const url = `https://map.kakao.com/link/to/${encodeURIComponent(
                  list[0].address
                )},${coords.lat},${coords.lng}`;
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
          setActiveOverlay(popupOverlay); // ✅ 추가
          console.log("[DEBUG][MAP] 🧩 팝업 표시 완료:", list[0].address);
        };

        // ✅ 안전 검사: 지도나 마커 엘리먼트가 존재하는지 확인
if (!map) {
  console.warn("[WARN][MAP] 지도(map)가 아직 생성되지 않아 이벤트 등록을 건너뜁니다.");
} else if (!markerEl) {
  console.warn("[WARN][MAP] markerEl이 존재하지 않아 이벤트 등록을 건너뜁니다.");
} else {
  markerEl.addEventListener("click", openPopup);
  markerEl.addEventListener("touchstart", openPopup);
}

      });

      // ✅ 지도 객체가 유효한지 검사 후 클릭 이벤트 등록
if (map && window.kakao?.maps?.event) {
  window.kakao.maps.event.addListener(map, "click", () => {
    const overlay = getActiveOverlay();
    if (overlay) {
      overlay.setMap(null);
      setActiveOverlay(null);
      activeOverlay = null;
      console.log("[DEBUG][MAP] 🧩 지도 클릭 — 팝업 닫기 (최신 참조)");
    }
  });
} else {
  console.warn("[WARN][MAP] ⚠️ 지도 객체가 아직 null이거나 kakao.maps.event가 로드되지 않음 — 클릭 이벤트 등록 건너뜀");
}

    } catch (e) {
      console.error("[ERROR][MAP] 마커 렌더링 실패:", e);
    }
  };

  /** 상태 업데이트 **/
  const updateStatus = async (meterIds, newStatus, coords) => {
    try {
      console.log("[DEBUG][STATUS] 🛠️ 상태 업데이트 시도:", meterIds, "→", newStatus);

      const payload = meterIds.map((id) => ({
        meter_id: id,
        address: data.find((d) => d.meter_id === id)?.address || "",
        status: newStatus,
        user_id: currentUser.id,
        lat: parseFloat(coords.lat),
        lng: parseFloat(coords.lng),
        updated_at: new Date().toISOString(),
      }));

      const { error: upsertError } = await supabase.from("meters").upsert(payload, {
        onConflict: ["meter_id", "address"],
      });
      if (upsertError) throw upsertError;
      console.log("[DEBUG][STATUS] ✅ Supabase 업데이트 완료:", payload);

      const { data: freshData, error: fetchError } = await supabase
        .from("meters")
        .select("*");
      if (fetchError) throw fetchError;

      setData(freshData);
      await renderMarkers();

      if (currentUser.can_view_others) await loadOtherUserLocations();

      const overlay = getActiveOverlay();
      if (overlay) {
        overlay.setMap(null);
        setActiveOverlay(null);
        activeOverlay = null;
        console.log("[DEBUG][POPUP] ✅ 팝업 닫힘 (updateStatus 후 보장)");
      }

      console.log("[DEBUG][STATUS] 🔁 전체 지도 최신화 완료");
    } catch (e) {
      console.error("[ERROR][STATUS] 저장 실패:", e.message);
    }
  };
  
/** ✅ 추가: Supabase 최신 상태 불러오기 **/
const fetchLatestStatus = async () => {
  try {
    console.log("[DEBUG][SYNC] 🔄 Supabase 최신 상태 재동기화 시작...");
    const { data: fresh, error } = await supabase
      .from("meters")
      .select("*")
      .order("updated_at", { ascending: false });
    if (error) throw error;

    // 최신 상태 반영
    const latestMap = {};
    fresh.forEach((row) => {
      if (!latestMap[row.meter_id]) latestMap[row.meter_id] = row;
    });
    const updated = data.map((d) =>
      latestMap[d.meter_id]
        ? { ...d, status: latestMap[d.meter_id].status }
        : d
    );

    setData(updated);
    console.log("[DEBUG][SYNC] ✅ 최신 상태 반영 완료:", updated.length);
    return updated;
  } catch (err) {
    console.error("[ERROR][SYNC] 상태 갱신 실패:", err.message);
    return data;
  }
};

/** 관리자 모드 **/

const loadOtherUserLocations = async () => {
  if (!map) return;

  // ✅ 기존 관리자 마커 제거
  otherUserOverlays.current.forEach((ov) => ov.setMap(null));
  otherUserOverlays.current = [];

  const { data: logs, error } = await supabase
    .from("meters")
    .select("address, lat, lng, status, user_id, updated_at")
    .not("user_id", "is", null)
    .order("updated_at", { ascending: false });

  if (error) throw error;

  const latest = {};
  logs.forEach((l) => {
    if (!l.user_id || !l.lat || !l.lng) return;
    if (!latest[l.user_id]) latest[l.user_id] = l;
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
      text-shadow: 0 0 3px black;
    `;
    markerEl.textContent = uid;

    const overlay = new window.kakao.maps.CustomOverlay({
      position: coord,
      content: markerEl,
      yAnchor: 2.5,
    });
    overlay.setMap(map);
    otherUserOverlays.current.push(overlay); // ✅ 변경
  });
};


  /** 로그인 UI **/
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

  /** 지도 UI **/
  return (
    <div style={{ width: "100%", height: "100vh", position: "relative" }}>
      <div
        style={{
          position: "fixed",
          top: 10,
          left: 10,
          background: "white",
          padding: "8px 12px",
          borderRadius: "8px",
          boxShadow: "0 2px 5px rgba(0,0,0,0.2)",
          zIndex: 999999,
          fontWeight: "bold",
        }}
      >
        ✅ 완료: {counts["완료"] || 0} | ❌ 불가: {counts["불가"] || 0} | 🟦 미방문:{" "}
        {counts["미방문"] || 0}
      </div>

      <button
        onClick={toggleMapType}
        style={{
          position: "fixed",
          bottom: 20,
          left: 20,
          zIndex: 999999,
          padding: "10px 14px",
          borderRadius: "8px",
          border: "none",
          background: "#333",
          color: "white",
          cursor: "pointer",
        }}
      >
        🗺️ 지도 전환 ({mapType === "ROADMAP" ? "스카이뷰" : "일반"})
      </button>

      {(currentUser?.can_view_others === true ||
        currentUser?.can_view_others === "y") && (
        <div
          style={{
            position: "fixed",
            bottom: 20,
            right: 20,
            zIndex: 999999,
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

      <div id="map" style={{ width: "100%", height: "100vh" }}></div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
