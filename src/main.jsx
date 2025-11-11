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
  const otherUserOverlays = useRef([]);
  const [geoCache, setGeoCache] = useState({});

  const GEO_CACHE_FILE = `geoCache_${currentUser?.data_file || "default"}.json`;

  let markers = [];
  let activeOverlay = null;

  const getActiveOverlay = () => window.__activeOverlayRef || null;
  const setActiveOverlay = (ov) => (window.__activeOverlayRef = ov);

  /** 로그인 **/
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

      const { data: dbData } = await supabase
        .from("meters")
        .select("*")
        .order("updated_at", { ascending: false });

      const latestMap = {};
      dbData?.forEach((d) => {
        if (!latestMap[d.meter_id]) latestMap[d.meter_id] = d;
      });

      const merged = baseData.map((x) => {
        const m = latestMap[x.meter_id];
        return m ? { ...x, status: m.status } : x;
      });

      setData(merged);
      console.log("[DEBUG][DATA] ✅ 병합 완료:", merged.length);
      setTimeout(() => renderMarkers(), 400);
    } catch (e) {
      console.error("[ERROR][DATA] 엑셀 로드 실패:", e.message);
    }
  };

  /** Kakao 지도 초기화 **/
  useEffect(() => {
    if (!loggedIn) return;
    console.log("[DEBUG][MAP] 🗺️ Kakao 지도 로드 중...");

    const script = document.createElement("script");
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_KEY}&autoload=false&libraries=services`;
    script.onload = () => {
      window.kakao.maps.load(() => {
        const mapInstance = new window.kakao.maps.Map(
          document.getElementById("map"),
          {
            center: new window.kakao.maps.LatLng(37.5665, 126.9780),
            level: 5,
          }
        );
        setMap(mapInstance);
      });
    };
    document.head.appendChild(script);
  }, [loggedIn]);

/** Supabase에서 geoCache 파일 로드 **/
useEffect(() => {
  if (!loggedIn || !currentUser) return;

  const loadGeoCache = async () => {
    try {
      console.log(`[DEBUG][CACHE] 📦 캐시 불러오기 시도: ${GEO_CACHE_FILE}`);
      const { data: cacheBlob, error } = await supabase.storage
        .from("excels")
        .download(`${GEO_CACHE_FILE}?v=${Date.now()}`); // ✅ 강제 캐시 무효화 추가

      if (error) {
        console.warn("[DEBUG][CACHE] ❌ 캐시 없음 — 새로 생성 예정");
        setGeoCache({});
        return;
      }

      console.log(
        `[DEBUG][CACHE] ✅ Blob 수신 완료 — 크기: ${cacheBlob.size.toLocaleString()} bytes`
      );

      // ✅ 1단계: Blob -> ArrayBuffer
      const arrayBuffer = await cacheBlob.arrayBuffer();
      console.log(
        `[DEBUG][CACHE] ✅ ArrayBuffer 생성 완료 — 길이: ${arrayBuffer.byteLength.toLocaleString()}`
      );

      // ✅ 2단계: 문자열 디코딩
      const decoder = new TextDecoder("utf-8");
      const text = decoder.decode(arrayBuffer);
      console.log(
        `[DEBUG][CACHE] ✅ TextDecoder 변환 완료 — 문자열 길이: ${text.length.toLocaleString()}`
      );

      // ✅ 3단계: 첫/끝 300자만 확인
      console.log("[DEBUG][CACHE] 📄 JSON 시작 부분 미리보기 ↓");
      console.log(text.slice(0, 300));
      console.log("[DEBUG][CACHE] 📄 JSON 끝 부분 미리보기 ↓");
      console.log(text.slice(-300));

      // ✅ 4단계: 파싱
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch (err) {
        console.error("[ERROR][CACHE] ❌ JSON 파싱 실패:", err.message);
        console.log("[DEBUG][CACHE] ⚠️ 텍스트 일부:", text.slice(0, 500));
        return;
      }

      // ✅ 5단계: 중첩 언랩
      let unwrapDepth = 0;
      while (
        Object.keys(parsed).length === 1 &&
        typeof parsed[Object.keys(parsed)[0]] === "object"
      ) {
        parsed = parsed[Object.keys(parsed)[0]];
        unwrapDepth++;
      }

      if (unwrapDepth > 0) {
        console.log(`[DEBUG][CACHE] ⚙️ 중첩 구조 ${unwrapDepth}회 언랩 처리됨`);
      }

      const keyCount = Object.keys(parsed).length;
      console.log(`[DEBUG][CACHE] ✅ ${keyCount}개 캐시 로드`);

      if (keyCount < 50) {
        console.warn(
          "[WARN][CACHE] ⚠️ 캐시 수가 비정상적으로 적음 — JSON 일부만 읽혔을 수 있음"
        );
      }

      // ✅ 6단계: 메모리 점검
      const sampleKeys = Object.keys(parsed).slice(0, 5);
      console.log("[DEBUG][CACHE] 🔍 샘플 키 5개:", sampleKeys);

      setGeoCache(parsed);
      setTimeout(() => renderMarkers(), 800);
    } catch (err) {
      console.error("[ERROR][CACHE] 캐시 로드 실패:", err.message);
    }
  };

  loadGeoCache();
}, [loggedIn, currentUser]);



  /** 주소 → 좌표 변환 (Python 캐시만 사용) **/
  const geocodeAddress = async (address) => {
    if (!address || address.trim() === "") {
      console.warn("[WARN][GEO] 주소 비어있음");
      return null;
    }
    if (geoCache[address]) {
      console.log(`[DEBUG][GEO] 💾 캐시 HIT: ${address}`);
      return geoCache[address];
    }
    console.warn(`[WARN][GEO] ❌ 캐시에 없는 주소 → ${address}`);
    return null;
  };

  /** 지도 타입 전환 **/
  const toggleMapType = () => {
    if (!map) return;
    const newType = mapType === "ROADMAP" ? "HYBRID" : "ROADMAP";
    map.setMapTypeId(
      newType === "ROADMAP"
        ? window.kakao.maps.MapTypeId.ROADMAP
        : window.kakao.maps.MapTypeId.HYBRID
    );
    console.log(`[DEBUG][MAP] 🗺️ 지도 타입 변경 → ${newType}`);
    setMapType(newType);
  };

  /** Supabase 실시간 리스너 **/
  useEffect(() => {
    if (!currentUser) return;
    const channel = supabase
      .channel("meters_realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "meters" },
        async (payload) => {
          console.log("[REALTIME] DB 변경 감지:", payload);
          await fetchLatestStatus();
          await renderMarkers();
        }
      )
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [currentUser]);

  /** 최신 상태 가져오기 **/
  const fetchLatestStatus = async () => {
    try {
      console.log("[DEBUG][SYNC] 🔄 Supabase 최신 상태 재동기화...");
      const { data: fresh, error } = await supabase
        .from("meters")
        .select("*")
        .order("updated_at", { ascending: false });
      if (error) throw error;

      const latestMap = {};
      fresh.forEach((r) => {
        if (!latestMap[r.meter_id]) latestMap[r.meter_id] = r;
      });
      const updated = data.map((d) =>
        latestMap[d.meter_id]
          ? { ...d, status: latestMap[d.meter_id].status }
          : d
      );

      setData(updated);
      console.log("[DEBUG][SYNC] ✅ 최신 상태 반영 완료");
      return updated;
    } catch (err) {
      console.error("[ERROR][SYNC] 상태 갱신 실패:", err.message);
      return data;
    }
  };

  // ✅ 거리 계산 함수 (미터 단위)
  const distanceInMeters = (lat1, lon1, lat2, lon2) => {
  const R = 6371000; // 지구 반경 (m)
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // 미터 단위로 반환
};

// ✅ 클릭한 지점 반경 1km 이내 마커들만 색상 업데이트 (빠른 버전)
const renderMarkersPartial = (coords, newStatus) => {
  const RADIUS = 1000; // 1km
  const lat = parseFloat(coords.lat);
  const lng = parseFloat(coords.lng);
  let updatedCount = 0;

  markers.forEach((overlay) => {
    const pos = overlay.getPosition?.();
    if (!pos) return;

    const mLat = pos.getLat();
    const mLng = pos.getLng();
    const d = distanceInMeters(lat, lng, mLat, mLng);

    if (d <= RADIUS) {
      const el = overlay.getContent();
      if (!el) return;

      const color =
        newStatus === "완료"
          ? "green"
          : newStatus === "불가"
          ? "red"
          : "blue";

      // ✅ 기존 요소의 색상만 바꾸기 (재생성 안함)
      el.style.background = color;
      el.style.transition = "background 0.3s ease";

      updatedCount++;
    }
  });

  console.log(`[DEBUG][MAP] 🟢 반경 1km 내 ${updatedCount}개 마커 색상만 변경`);
};


  

 /** 마커 렌더링 **/
const renderMarkers = async () => {
  try {
    if (!map || !data.length) {
      console.warn("[DEBUG][MAP] ❌ 지도나 데이터가 아직 준비되지 않음");
      return;
    }

    console.log("[DEBUG][MAP] 🔄 마커 렌더링 시작...");

    // ✅ 기존 마커 제거
    markers.forEach((m) => m.setMap(null));
    markers = [];

    const grouped = {};
    const failedAddresses = [];
    const statusCount = { 완료: 0, 불가: 0, 미방문: 0 };

    // ✅ 최신 데이터만 유지
    const latestPerMeter = {};
    data.forEach((d) => {
      statusCount[d.status] = (statusCount[d.status] || 0) + 1;
      if (!latestPerMeter[d.meter_id]) latestPerMeter[d.meter_id] = d;
    });
    const filteredData = Object.values(latestPerMeter);
    // 수정
    setCounts((prev) => {
      const same =
      prev.완료 === statusCount.완료 &&
      prev.불가 === statusCount.불가 &&
      prev.미방문 === statusCount.미방문;
    return same ? prev : statusCount; // ✅ 값이 같으면 state 변경 안 함
    });

    console.log(
      `[DEBUG][MAP] ✅ 데이터 정제 완료 — ${filteredData.length}건 처리 중...`
    );

    // ✅ 주소 그룹핑 + 캐시 좌표 매칭
    const uniqueGroupSet = new Set();
    for (const row of filteredData) {
      if (!row.address) continue;

      const cleanAddr = row.address.trim().replace(/\s+/g, " ");
      let coords = geoCache[cleanAddr];

      // 🔍 공백 제거 후 대체 매칭
      if (!coords) {
        const altKey = Object.keys(geoCache).find(
          (k) => k.replace(/\s+/g, "") === cleanAddr.replace(/\s+/g, "")
        );
        if (altKey) {
          coords = geoCache[altKey];
          console.log(
            `[DEBUG][GEO] ⚙️ 캐시 대체 매칭 성공: ${cleanAddr} → ${altKey}`
          );
        }
      }

      if (!coords) {
        failedAddresses.push(cleanAddr);
        continue;
      }

      const key = `${coords.lat},${coords.lng}`;
      const uniqueKey = `${cleanAddr}_${row.meter_id}`;
      if (uniqueGroupSet.has(uniqueKey)) continue;
      uniqueGroupSet.add(uniqueKey);

      if (!grouped[key]) grouped[key] = { coords, list: [] };
      grouped[key].list.push(row);
    }

    // ⚠️ 실패 주소 통계
    if (failedAddresses.length > 0) {
      console.warn(
        `[WARN][GEO] ❌ 좌표 실패 ${failedAddresses.length}건 / ${data.length}행`
      );
      console.log("[DEBUG][GEO] 🔍 실패 샘플:", failedAddresses.slice(0, 10));
    }

    // ✅ 계기타입 매핑표
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

    // ✅ 마커 생성
    let markerCount = 0;
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
        width:30px;height:30px;
        color:white;font-size:12px;
        line-height:30px;text-align:center;
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
      markers.push(overlay);
      markerCount++;

      // ✅ 클릭 팝업
      const openPopup = async (e) => {
        e.stopPropagation();
        await fetchLatestStatus();
        const old = getActiveOverlay();
        if (old) old.setMap(null);

        const popupEl = document.createElement("div");
        popupEl.style.cssText = `
          background:white;
          padding:10px;
          border:1px solid #ccc;
          border-radius:8px;
          width:230px;
          box-shadow:0 2px 8px rgba(0,0,0,0.2);
        `;

        const title = document.createElement("b");
        title.textContent = list[0].address;
        popupEl.appendChild(title);
        popupEl.appendChild(document.createElement("br"));
        popupEl.appendChild(document.createElement("br"));

        const allIds = list.map((g) => g.meter_id);
        const duplicates = allIds.filter(
          (id, i) => allIds.indexOf(id) !== i
        );
        const uniqueMeters = Array.from(new Set(allIds));

        uniqueMeters.forEach((id) => {
          const div = document.createElement("div");
          const mid = id.substring(2, 4);
          const type = meter_mapping[mid] || "확인필요";
          div.textContent = `${id} | ${type}`;
          if (duplicates.includes(id)) div.style.color = "red";
          popupEl.appendChild(div);
        });

        popupEl.appendChild(document.createElement("hr"));

        ["완료", "불가", "미방문", "가기"].forEach((text) => {
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
        setActiveOverlay(popupOverlay);
      };

      markerEl.addEventListener("click", openPopup);
      markerEl.addEventListener("touchstart", openPopup);
    });

    console.log(`[DEBUG][MAP] ✅ 마커 ${markerCount}개 렌더링 완료`);
  } catch (e) {
    console.error("[ERROR][MAP] 마커 렌더링 실패:", e);
  }
};

  /** ✅ 마커 렌더링 자동 트리거 — map + data + geoCache 모두 준비된 뒤 실행 **/
useEffect(() => {
  if (!map) {
    console.log("[DEBUG][MAP] ⏳ 지도 아직 로드 안됨");
    return;
  }
  if (!data || data.length === 0) {
    console.log("[DEBUG][MAP] ⏳ 데이터 아직 없음");
    return;
  }
  if (!geoCache || Object.keys(geoCache).length === 0) {
    console.log("[DEBUG][MAP] ⏳ 캐시 아직 없음");
    return;
  }

  console.log("[DEBUG][MAP] ✅ 지도+데이터+캐시 준비 완료 → 마커 렌더링 실행");
  renderMarkers();
}, [map, data, geoCache]);


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

      console.log("[DEBUG][STATUS] ✅ DB 업데이트 완료:", payload);

      await fetchLatestStatus();
      renderMarkersPartial(coords, newStatus); // ✅ 이걸로 교체


      if (currentUser.can_view_others) await loadOtherUserLocations();

      const overlay = getActiveOverlay();
      if (overlay) {
        overlay.setMap(null);
        setActiveOverlay(null);
        activeOverlay = null;
      }

      console.log("[DEBUG][STATUS] 🔁 전체 지도 최신화 완료");
    } catch (e) {
      console.error("[ERROR][STATUS] 저장 실패:", e.message);
    }
  };

  /** 관리자 모드: 다른 사용자 위치 불러오기 **/
  const loadOtherUserLocations = async () => {
    if (!map) return;
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
        text-shadow:0 0 3px black;
      `;
      markerEl.textContent = uid;

      const overlay = new window.kakao.maps.CustomOverlay({
        position: coord,
        content: markerEl,
        yAnchor: 2.5,
      });
      overlay.setMap(map);
      otherUserOverlays.current.push(overlay);
    });
  };

  /** 내 위치 마커 **/
  useEffect(() => {
    if (!map || !currentUser) return;
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
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
        },
        (err) => console.warn("[DEBUG][GEO] ⚠️ 위치 불러오기 실패:", err.message)
      );
    }
  }, [map, currentUser]);

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
