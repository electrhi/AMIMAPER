import React, { useEffect, useState, useRef } from "react";
import ReactDOM from "react-dom/client";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY;
const KAKAO_KEY = import.meta.env.VITE_KAKAO_JAVASCRIPT_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ✅ 계기번호 공통 정규화 함수 (모든 종류의 공백/제로폭문자 제거)
const normalizeMeterId = (id) =>
  String(id ?? "")
    // 일반 공백 + 탭 + 줄바꿈 + NBSP(0xA0) + 제로폭 공백들 제거
    .replace(/[\s\u00A0\u200B-\u200D\uFEFF]/g, "")
    .trim();

// ✅ debounce (300~500ms 권장)
const debounce = (fn, delay = 400) => {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), delay);
  };
};

// ✅ 배열 chunk (Supabase in() 길이 대비)
const chunkArray = (arr, size = 500) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};



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
  // 🔹 주소 라벨 오버레이들 저장
  const addressOverlaysRef = useRef([]);
  // 🔹 이 레벨 이하에서만 주소 라벨을 보여준다 (값은 취향대로 조절)
  const LABEL_SHOW_LEVEL = 5;

  // 🔴 내 위치 오버레이 & watchId
  const myLocationOverlayRef = useRef(null);
  const myLocationWatchIdRef = useRef(null);

  // ✅ 마커 개수 필터 (입력 숫자 이상만 표시, 비어 있으면 전체)
  const [minMarkerCount, setMinMarkerCount] = useState("");

  console.log("[DEBUG][SUPABASE_URL]", SUPABASE_URL);

  // 예: 데이터 파일이 "djdemo.xlsx" 라면 geoCache 파일명은 "geoCache_djdemo.xlsx.json"
  const GEO_CACHE_FILE = `geoCache_${currentUser?.data_file || "default"}.json`;

  // 🔹 마커 오버레이들을 유지하기 위한 ref
  const markersRef = useRef([]);

  // ✅ 최신 data를 이벤트 핸들러에서 안전하게 쓰기 위한 ref
const dataRef = useRef([]);
useEffect(() => {
  dataRef.current = data;
}, [data]);

// ✅ meters 최신 상태 캐시 (meter_id -> row)
const metersCacheRef = useRef(new Map());

// ✅ fetch 중복/경합 방지용 시퀀스
const metersFetchSeqRef = useRef(0);

// ✅ meters 상태를 "특정 meterIds"만 DB에서 읽어와서 data에 반영
const fetchMetersStatusByIds = async (meterIds) => {
  const ids = Array.from(new Set((meterIds || []).map(normalizeMeterId))).filter(Boolean);
  if (ids.length === 0) return;

  console.count("[DEBUG][FETCH] meters by ids"); // ✅ 호출 위치/횟수 추적

  const seq = ++metersFetchSeqRef.current;

  // ✅ 필요한 컬럼만 (select=* 금지)
  const columns = "meter_id,status,updated_at";

  let rows = [];
  for (const part of chunkArray(ids, 500)) {
    const dataFile = currentUser?.data_file;
if (!dataFile) return;

const { data: chunkRows, error } = await supabase
  .from("meters")
  .select(columns)
  .eq("data_file", dataFile)
  .in("meter_id", part);

    if (error) {
      console.error("[ERROR][FETCH] meters:", error.message);
      return;
    }
    rows = rows.concat(chunkRows || []);
  }

  // 더 최신 요청이 이미 시작됐으면 이번 결과는 버림
  if (seq !== metersFetchSeqRef.current) return;

  // meter_id별 가장 최신(updated_at)만 남기기
  const latest = new Map();
  for (const r of rows) {
    const id = normalizeMeterId(r.meter_id);
    const prev = latest.get(id);
    if (!prev || new Date(r.updated_at) > new Date(prev.updated_at)) latest.set(id, r);
  }

  // 캐시 업데이트
  for (const [id, r] of latest.entries()) metersCacheRef.current.set(id, r);

  // data에 status만 반영
  setData((prev) =>
    prev.map((row) => {
      const id = normalizeMeterId(row.meter_id);
      const m = latest.get(id);
      return m ? { ...row, status: m.status || row.status } : row;
    })
  );
};


  // activeOverlay 는 지금처럼 window 전역 써도 OK
  const getActiveOverlay = () => window.__activeOverlayRef || null;
  const setActiveOverlay = (ov) => (window.__activeOverlayRef = ov);


  /** 🔐 수동 로그인 처리 **/
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

      // ✅ 로컬에 user id 저장 → 다음 접속 시 자동 로그인에 사용
      try {
        localStorage.setItem("amimap_user_id", userData.id);
        console.log("[DEBUG][AUTH] 로컬스토리지에 사용자 ID 저장:", userData.id);
      } catch (err) {
        console.warn("[WARN][AUTH] 로컬스토리지 저장 실패:", err?.message);
      }

      setCurrentUser(userData);
      await loadData(userData.data_file);
      setLoggedIn(true);
    } else {
      console.warn("[DEBUG][LOGIN] ❌ 로그인 실패");
      alert("로그인 실패");
    }
  };

  /** 🔐 앱 시작 시 자동 로그인 시도 **/
  useEffect(() => {
    const autoLogin = async () => {
      if (loggedIn) {
        console.log("[DEBUG][AUTH] 이미 로그인 상태 — 자동 로그인 스킵");
        return;
      }

      let savedId = null;
      try {
        savedId = localStorage.getItem("amimap_user_id");
      } catch (err) {
        console.warn("[WARN][AUTH] 로컬스토리지 접근 실패:", err?.message);
      }

      if (!savedId) {
        console.log("[DEBUG][AUTH] 저장된 사용자 ID 없음 — 자동 로그인 안 함");
        return;
      }

      console.log("[DEBUG][AUTH] 자동 로그인 시도 — 저장된 ID:", savedId);

      const { data: users, error } = await supabase
        .from("users")
        .select("*")
        .eq("id", savedId);

      if (error) {
        console.error(
          "[ERROR][AUTH] 자동 로그인 중 Supabase 오류:",
          error.message
        );
        return;
      }

      if (!users || users.length === 0) {
        console.warn(
          "[WARN][AUTH] 저장된 ID에 해당하는 사용자를 찾지 못함 → 로컬 정보 제거"
        );
        try {
          localStorage.removeItem("amimap_user_id");
        } catch {}
        return;
      }

      const userData = users[0];
      console.log("[DEBUG][AUTH] ✅ 자동 로그인 사용자 데이터:", userData);

      setCurrentUser(userData);
      await loadData(userData.data_file);
      setLoggedIn(true);
    };

    autoLogin();
  }, [loggedIn]);

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

      // 1) 엑셀에서는 상태(status)를 더 이상 쓰지 않음
      const baseData = json.map((r) => ({
        meter_id: normalizeMeterId(r["계기번호"]),
        address: r["주소"],
        comm_type: r["통신방식"] || "", // 예: KS-PLC, LTE
        list_no: r["리스트번호"] || "", // 예: 5131, 5152
      }));

      // ✅ 2) DB에서 최신 상태를 "엑셀에 있는 meter_id들만" 읽어오기 (전체 select(*) 금지)
const excelIds = baseData.map((x) => normalizeMeterId(x.meter_id)).filter(Boolean);

const columns = "meter_id,status,updated_at";
let rows = [];
for (const part of chunkArray(excelIds, 500)) {
  const { data: chunkRows, error } = await supabase
  .from("meters")
  .select(columns)
  .eq("data_file", fileName)
  .in("meter_id", part);


  if (error) throw error;
  rows = rows.concat(chunkRows || []);
}

const latestMap = {};
rows.forEach((d) => {
  const key = normalizeMeterId(d.meter_id);
  if (!latestMap[key] || new Date(d.updated_at) > new Date(latestMap[key].updated_at)) {
    latestMap[key] = d;
  }
});



      // 3) 상태는 "DB 값 > 없으면 미방문" 이라는 한 가지 규칙만 사용
      const merged = baseData.map((x) => {
        const key = normalizeMeterId(x.meter_id);
        const m = latestMap[key];
        return {
          ...x,
          status: m?.status || "미방문",
        };
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
            center: new window.kakao.maps.LatLng(37.5665, 126.978),
            level: 5,
          }
        );
        setMap(mapInstance);
      });
    };
    document.head.appendChild(script);
  }, [loggedIn]);

  // ✅ 지도 이동/줌 종료 시: 화면(bounds) 안에 있는 계기들만 상태 동기화 (디바운스)
useEffect(() => {
  if (!map || !window.kakao?.maps) return;

  const syncInView = async () => {
    console.count("[DEBUG][FETCH] sync in view"); // ✅ 호출 추적

    const b = map.getBounds();
    const sw = b.getSouthWest();
    const ne = b.getNorthEast();

    const swLat = sw.getLat();
    const swLng = sw.getLng();
    const neLat = ne.getLat();
    const neLng = ne.getLng();

    // ✅ 현재 화면에 보이는 meter_id만 추림 (엑셀 좌표 기준)
    const visibleIds = [];
    for (const row of dataRef.current) {
      if (row.lat == null || row.lng == null) continue;
      if (
        row.lat >= swLat && row.lat <= neLat &&
        row.lng >= swLng && row.lng <= neLng
      ) {
        visibleIds.push(row.meter_id);
      }
    }

    await fetchLatestStatus(visibleIds);
  };

  const debounced = debounce(syncInView, 400);

  const onDragEnd = () => debounced();
  const onZoomChanged = () => debounced();

  window.kakao.maps.event.addListener(map, "dragend", onDragEnd);
  window.kakao.maps.event.addListener(map, "zoom_changed", onZoomChanged);

  // 최초 1회
  debounced();

  return () => {
    window.kakao.maps.event.removeListener(map, "dragend", onDragEnd);
    window.kakao.maps.event.removeListener(map, "zoom_changed", onZoomChanged);
  };
}, [map]);


  /** Supabase에서 geoCache 파일 로드 (지오코딩 결과 JSON) **/
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

        console.log(
          `[DEBUG][CACHE] ✅ Blob 수신 완료 — 크기: ${cacheBlob.size.toLocaleString()} bytes`
        );

        const arrayBuffer = await cacheBlob.arrayBuffer();
        console.log(
          `[DEBUG][CACHE] ✅ ArrayBuffer 생성 완료 — 길이: ${arrayBuffer.byteLength.toLocaleString()}`
        );

        const decoder = new TextDecoder("utf-8");
        const text = decoder.decode(arrayBuffer);
        console.log(
          `[DEBUG][CACHE] ✅ TextDecoder 변환 완료 — 문자열 길이: ${text.length.toLocaleString()}`
        );

        console.log("[DEBUG][CACHE] 📄 JSON 시작 부분 미리보기 ↓");
        console.log(text.slice(0, 300));
        console.log("[DEBUG][CACHE] 📄 JSON 끝 부분 미리보기 ↓");
        console.log(text.slice(-300));

        let parsed;
        try {
          parsed = JSON.parse(text);
        } catch (err) {
          console.error("[ERROR][CACHE] ❌ JSON 파싱 실패:", err.message);
          console.log("[DEBUG][CACHE] ⚠️ 텍스트 일부:", text.slice(0, 500));
          return;
        }

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

        const sampleKeys = Object.keys(parsed).slice(0, 5);
        console.log("[DEBUG][CACHE] 🔍 샘플 키 5개:", sampleKeys);

        const cleanedCache = {};
        Object.entries(parsed).forEach(([k, v]) => {
          const cleanKey = k.trim().replace(/\s+/g, " ");
          cleanedCache[cleanKey] = v;
        });
        setGeoCache(cleanedCache);

        setTimeout(() => renderMarkers(), 800);
      } catch (err) {
        console.error("[ERROR][CACHE] 캐시 로드 실패:", err.message);
      }
    };

    loadGeoCache();
  }, [loggedIn, currentUser]);

  /** 주소 → 좌표 변환 (Python 캐시만 사용, Kakao 지오코딩 호출 X) **/
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

  /** 마커 개수 필터 적용 버튼 **/
  const handleApplyFilter = () => {
    console.log("[DEBUG][FILTER] 적용 시도, minMarkerCount =", minMarkerCount);
    renderMarkers();
  };

/** 최신 상태 가져오기 (DB 읽기 - 필요한 것만) **/
const fetchLatestStatus = async (meterIds = null) => {
  try {
    console.log("[DEBUG][SYNC] 🔄 최신 상태 동기화...");

    const ids = meterIds
      ? meterIds.map(normalizeMeterId).filter(Boolean)
      : dataRef.current.map((d) => normalizeMeterId(d.meter_id)).filter(Boolean);

    await fetchMetersStatusByIds(ids);

    console.log("[DEBUG][SYNC] ✅ 최신 상태 반영 완료");
  } catch (err) {
    console.error("[ERROR][SYNC] 상태 갱신 실패:", err.message);
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

    markersRef.current.forEach((overlay) => {
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

        el.style.background = color;
        el.style.transition = "background 0.3s ease";

        updatedCount++;
      }
    });

    console.log(`[DEBUG][MAP] 🟢 반경 1km 내 ${updatedCount}개 마커 색상만 변경`);
  };

  /** ✅ geoCache 매칭 (엑셀 address ↔ JSON 좌표) **/
  useEffect(() => {
    if (!geoCache || Object.keys(geoCache).length === 0) return;
    if (!data || data.length === 0) return;

    console.log("[DEBUG][GEO] 🔄 geoCache 매칭 시작 (유사 주소 매칭 포함)");

    const normalizeAddr = (str) =>
      str
        ?.toString()
        .trim()
        .replace(/\s+/g, " ")
        .replace(/\u3000/g, " ")
        .replace(/\r|\n|\t/g, "")
        .replace(/번지/g, "")
        .replace(/ /g, ""); // ✅ 모든 공백 완전 제거

    const normalizedCacheEntries = Object.entries(geoCache).map(([k, v]) => [
      normalizeAddr(k),
      v,
    ]);

    let matchedCount = 0;
    const failedSamples = [];

    const matchedData = data.map((row, idx) => {
      const addr = normalizeAddr(row.address);
      if (!addr) return { ...row, lat: null, lng: null };

      // 1단계: 완전 일치
      const exact = normalizedCacheEntries.find(([key]) => key === addr);
      if (exact) {
        matchedCount++;
        return {
          ...row,
          lat: parseFloat(exact[1].lat),
          lng: parseFloat(exact[1].lng),
        };
      }

      // 2단계: 부분 포함
      const partial = normalizedCacheEntries.find(
        ([key]) => key.includes(addr) || addr.includes(key)
      );
      if (partial) {
        matchedCount++;
        return {
          ...row,
          lat: parseFloat(partial[1].lat),
          lng: parseFloat(partial[1].lng),
        };
      }

      // 3단계: 비슷한 문자열 (동 이름 + 끝쪽 숫자 비교 등)
      const parts = addr.split(" ");
      const dongName = parts[2] || parts[1] || parts[0];
      const similar = normalizedCacheEntries.find(([key]) => {
        return key.includes(dongName) && key.slice(-5) === addr.slice(-5);
      });
      if (similar) {
        matchedCount++;
        return {
          ...row,
          lat: parseFloat(similar[1].lat),
          lng: parseFloat(similar[1].lng),
        };
      }

      // 매칭 실패 샘플 기록
      if (failedSamples.length < 15) {
        failedSamples.push({
          excel: row.address,
          exampleCacheKey: normalizedCacheEntries[idx]?.[0],
        });
      }

      return { ...row, lat: null, lng: null };
    });

    console.log(
      `[DEBUG][GEO] ✅ geoCache 매칭 완료: ${matchedCount}/${matchedData.length}건`
    );
    if (failedSamples.length > 0) {
      console.groupCollapsed("[DEBUG][GEO] ❌ 매칭 실패 샘플");
      console.table(failedSamples);
      console.groupEnd();
    }

    setData(matchedData);
  }, [geoCache]);

  /** 마커 렌더링 **/
  const renderMarkers = async () => {
    try {
      if (!map || !data.length) {
        console.warn("[DEBUG][MAP] ❌ 지도나 데이터가 아직 준비되지 않음");
        return;
      }

      console.log("[DEBUG][MAP] 🔄 마커 렌더링 시작...");

      // ✅ 마커 개수 필터 값 파싱 (입력 비었거나 0 이하면 필터 끔)
      const threshold = parseInt(minMarkerCount, 10);
      const useSizeFilter = !isNaN(threshold) && threshold > 0;
      if (useSizeFilter) {
        console.log(
          `[DEBUG][FILTER] 최소 ${threshold}개 이상인 마커만 표시`
        );
      } else {
        console.log("[DEBUG][FILTER] 필터 미사용(전체 표시)");
      }

      // 기존 마커 제거
      markersRef.current.forEach((m) => m.setMap(null));
      markersRef.current = [];

      // 🔹 기존 주소 라벨 제거
      addressOverlaysRef.current.forEach((ov) => ov.setMap(null));
      addressOverlaysRef.current = [];

      const grouped = {};
      const statusCount = { 완료: 0, 불가: 0, 미방문: 0 };

      // meter_id 기준 최신 데이터만 유지
      const latestPerMeter = {};
      data.forEach((d) => {
        statusCount[d.status] = (statusCount[d.status] || 0) + 1;
        if (!latestPerMeter[d.meter_id]) latestPerMeter[d.meter_id] = d;
      });
      const filteredData = Object.values(latestPerMeter);

      // 상태 카운트 최소 변경
      setCounts((prev) => {
        const same =
          prev.완료 === statusCount.완료 &&
          prev.불가 === statusCount.불가 &&
          prev.미방문 === statusCount.미방문;
        return same ? prev : statusCount;
      });

      console.log(
        `[DEBUG][MAP] ✅ 데이터 정제 완료 — ${filteredData.length}건 처리 중...`
      );

      // 좌표 기준 그룹핑
      const uniqueGroupSet = new Set();
      for (const row of filteredData) {
        const { address, lat, lng } = row;
        if (!lat || !lng || !address) continue;

        const cleanAddr = address.trim().replace(/\s+/g, " ");
        const key = `${lat},${lng}`;
        const uniqueKey = `${cleanAddr}_${row.meter_id}`;
        if (uniqueGroupSet.has(uniqueKey)) continue;
        uniqueGroupSet.add(uniqueKey);

        if (!grouped[key]) grouped[key] = { coords: { lat, lng }, list: [] };
        grouped[key].list.push(row);
      }

      // 계기 타입 매핑
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

      let markerCount = 0;
      Object.keys(grouped).forEach((key) => {
        const { coords, list } = grouped[key];

        // ✅ 마커 개수 필터: list.length 가 threshold 미만이면 스킵
        if (useSizeFilter && list.length < threshold) {
          return;
        }

        const 진행 = list[0].status;
        const color =
          진행 === "완료" ? "green" : 진행 === "불가" ? "red" : "blue";

        const kakaoCoord = new window.kakao.maps.LatLng(
          coords.lat,
          coords.lng
        );

        const markerEl = document.createElement("div");
        markerEl.style.cssText = `
          background:${color};
          border-radius:50%;
          width:21px;height:21px;
          color:white;font-size:11px;
          line-height:21px;text-align:center;
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
        markersRef.current.push(overlay);
        markerCount++;

        // 🔹 현재 지도 레벨 기준으로 라벨 표시 여부 결정
        const currentLevel = map.getLevel();
        const showLabel = currentLevel <= LABEL_SHOW_LEVEL;

        // 🔹 주소 라벨용 엘리먼트
        const labelEl = document.createElement("div");
        labelEl.style.cssText = `
          background: rgba(255,255,255,0.9);
          border-radius: 4px;
          padding: 2px 4px;
          border: 1px solid #ddd;
          font-size: 11px;
          white-space: nowrap;
          transform: translateY(-4px);
        `;
        labelEl.textContent = list[0].address; // 첫 번째 주소 사용

        // ✅ 라벨은 클릭/터치 이벤트를 막고, 아래 마커가 클릭되게 하기
        labelEl.style.pointerEvents = "none";

        const labelOverlay = new window.kakao.maps.CustomOverlay({
          position: kakaoCoord,
          content: labelEl,
          yAnchor: 1.7, // 마커 조금 위쪽에 표시
          zIndex: 5,
        });

        // 🔹 레벨 조건에 따라 처음 렌더 시 보이거나 숨기기
        labelOverlay.setMap(showLabel ? map : null);
        addressOverlaysRef.current.push(labelOverlay);

        // 마커 클릭 시 팝업 + 상태 버튼
        const openPopup = async (e) => {
          e.stopPropagation();
          // 여기서 최신 상태 1회 동기화 (클릭 시에만 호출)
          await fetchLatestStatus(list.map((g) => g.meter_id));

          const old = getActiveOverlay();
          if (old) old.setMap(null);

          const popupEl = document.createElement("div");
          popupEl.style.cssText = `
            position: relative;
            background:white;
            padding:10px;
            border:1px solid #ccc;
            border-radius:8px;
            width:230px;
            box-shadow:0 2px 8px rgba(0,0,0,0.2);
            font-size:12px;
          `;

          // ✕ 닫기 버튼
          const closeBtn = document.createElement("button");
          closeBtn.textContent = "✕";
          closeBtn.style.cssText = `
            position:absolute;
            top:4px;
            right:4px;
            border:none;
            background:transparent;
            font-size:14px;
            cursor:pointer;
          `;
          closeBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            const ov = getActiveOverlay();
            if (ov) {
              ov.setMap(null);
              setActiveOverlay(null);
              activeOverlay = null;
              console.log("[DEBUG][POPUP] ✕ 버튼 클릭 — 팝업 닫힘");
            }
          });
          popupEl.appendChild(closeBtn);

          const title = document.createElement("b");
          title.textContent = list[0].address;
          popupEl.appendChild(title);
          popupEl.appendChild(document.createElement("br"));
          popupEl.appendChild(document.createElement("br"));

          // 하나의 마커에 포함된 모든 계기번호 (문자열로 정규화)
          const allIds = list.map((g) => String(g.meter_id || ""));

          // ✅ 계기번호 뒤 2자리 기준으로 중복 개수 계산
          const suffixCount = {};
          allIds.forEach((id) => {
            const suffix = id.slice(-2); // 맨 오른쪽 2자리
            if (!suffix) return;
            suffixCount[suffix] = (suffixCount[suffix] || 0) + 1;
          });

          // 중복 제거한 계기번호 목록
          const uniqueMeters = Array.from(new Set(allIds));

          uniqueMeters.forEach((id) => {
            // 이 계기번호에 해당하는 행 하나 찾아서 통신방식/리스트번호 가져오기
            const row =
              list.find((g) => String(g.meter_id || "") === id) || {};

            const mid = id.substring(2, 4);
            const type = meter_mapping[mid] || "확인필요";

            const listNo = row.list_no || "";
            const commType = row.comm_type || "";

            const div = document.createElement("div");
            // ✅ 원하는 출력 형식: 리스트번호 | 통신방식 | 계기번호 | 계기타입
            div.textContent = `${listNo} | ${commType} | ${id} | ${type}`;

            // 기본 스타일
            div.style.padding = "2px 0";
            div.style.cursor = "pointer";
            div.title = "클릭 시 계기번호 복사";

            // ✅ 뒤 2자리가 같은 계기번호들만 빨간색 처리
            const suffix = id.slice(-2);
            if (suffix && suffixCount[suffix] > 1) {
              div.style.color = "red";
            }

            // ✅ 클릭 시 계기번호 클립보드 복사
            div.addEventListener("click", (e) => {
              e.stopPropagation(); // 팝업/마커 클릭 이벤트로 안 올라가게

              const meterIdToCopy = id;

              if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard
                  .writeText(meterIdToCopy)
                  .then(() => {
                    // 살짝 하이라이트 효과
                    const oldBg = div.style.backgroundColor;
                    div.style.backgroundColor = "#f0f8ff";
                    setTimeout(() => {
                      div.style.backgroundColor = oldBg;
                    }, 200);
                    console.log(
                      "[DEBUG][COPY] 계기번호 복사 완료:",
                      meterIdToCopy
                    );
                  })
                  .catch((err) => {
                    console.warn("[DEBUG][COPY] 클립보드 복사 실패:", err);
                    alert("복사에 실패했습니다. 다시 시도해주세요.");
                  });
              } else {
                // 구형 브라우저 대응 (거의 안 쓸 가능성 높지만 백업용)
                const textarea = document.createElement("textarea");
                textarea.value = meterIdToCopy;
                textarea.style.position = "fixed";
                textarea.style.top = "-9999px";
                document.body.appendChild(textarea);
                textarea.focus();
                textarea.select();
                try {
                  document.execCommand("copy");
                  console.log(
                    "[DEBUG][COPY] execCommand 로 계기번호 복사:",
                    meterIdToCopy
                  );
                } catch (err) {
                  alert("복사에 실패했습니다. 직접 복사해주세요.");
                }
                document.body.removeChild(textarea);
              }
            });

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
                // ✅ 여기서만 DB에 상태 업로드 (완료/불가/미방문)
                await updateStatus(
                  list.map((g) => g.meter_id),
                  text,
                  coords
                );
              }
            });
            popupEl.appendChild(btn);
          });

          const popupOverlay = new window.kakao.maps.CustomOverlay({
            position: kakaoCoord,
            content: popupEl,
            yAnchor: 1.1, // 마커 바로 위에 가깝게 위치
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

  /** ✅ 마커 렌더링 자동 트리거 (지도, 데이터, geoCache 모두 준비된 뒤 실행) **/
  useEffect(() => {
    let checkCount = 0;
    const maxWait = 50; // 최대 5초까지 대기

    const waitForReady = async () => {
      checkCount++;

      // Kakao SDK 로드 확인
      if (typeof window.kakao === "undefined" || !window.kakao.maps) {
        console.log(
          `[DEBUG][MAP] ⚙️ Kakao SDK 아직 로드 안됨 (${checkCount}/${maxWait})`
        );
        if (checkCount < maxWait) return setTimeout(waitForReady, 100);
        console.warn("[DEBUG][MAP] ❌ Kakao SDK 로드 실패로 렌더링 중단");
        return;
      }

      const ready =
        map instanceof window.kakao.maps.Map &&
        data.length > 0 &&
        Object.keys(geoCache).length > 0;

      if (!ready) {
        if (checkCount <= maxWait) {
          console.log(
            `[DEBUG][MAP] ⏳ 준비 대기중 (${checkCount}/${maxWait}) → map:${
              !!map
            }, data:${data.length}, geoCache:${Object.keys(geoCache).length}`
          );
          return setTimeout(waitForReady, 100);
        } else {
          console.warn(
            "[DEBUG][MAP] ⚠️ 지도 또는 데이터 준비 지연으로 렌더 스킵"
          );
          return;
        }
      }

      console.log("[DEBUG][MAP] ✅ 모든 요소 준비 완료 → 마커 렌더링 실행");
      await renderMarkers();
    };

    waitForReady();
  }, [map, data, geoCache]);

  // 🔹 줌 레벨에 따라 주소 라벨 토글
  useEffect(() => {
    if (!map || typeof window.kakao === "undefined") return;

    const handler = () => {
      const level = map.getLevel();
      const show = level <= LABEL_SHOW_LEVEL;

      addressOverlaysRef.current.forEach((ov) => {
        ov.setMap(show ? map : null);
      });
    };

    window.kakao.maps.event.addListener(map, "zoom_changed", handler);

    // cleanup
    return () => {
      window.kakao.maps.event.removeListener(map, "zoom_changed", handler);
    };
  }, [map]);

  /** 상태 업데이트 (버튼 클릭 시만 DB 업로드) **/
  const updateStatus = async (meterIds, newStatus, coords) => {
    try {
      console.log(
        "[DEBUG][STATUS] 🛠️ 상태 업데이트 시도:",
        meterIds,
        "→",
        newStatus
      );

      const payload = meterIds.map((id) => {
        const normId = normalizeMeterId(id);
        const row =
          data.find(
            (d) => normalizeMeterId(d.meter_id) === normId
          ) || {};
        return {
          data_file: currentUser.data_file,   // ✅ 추가
          meter_id: normId,
          address: row.address || "",
          status: newStatus,
          user_id: currentUser.id,
          lat: parseFloat(coords.lat),
          lng: parseFloat(coords.lng),
          updated_at: new Date().toISOString(),
        };
      });

      const { error: upsertError } = await supabase
  .from("meters")
  .upsert(payload, { onConflict: "data_file,meter_id,address" })
  .select("meter_id"); // ✅ 응답 최소화

if (upsertError) throw upsertError;

console.log("[DEBUG][STATUS] ✅ DB 업데이트 완료:", payload);

// ✅ 최신 상태는 "방금 업데이트한 계기들만" 반영
await fetchLatestStatus(payload.map((p) => p.meter_id));

      // 전체 재렌더 대신 근처 마커 색만 빠르게 업데이트
      renderMarkersPartial(coords, newStatus);

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

    // 기존 관리자 오버레이 제거
    otherUserOverlays.current.forEach((ov) => ov.setMap(null));
    otherUserOverlays.current = [];

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: logs, error } = await supabase
      .from("user_last_locations")
      .select("user_id, address, lat, lng, status, updated_at, data_file");

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
        cursor:pointer;          /* 👉 클릭 가능 느낌 */
      `;
      markerEl.textContent = uid;

      // 👉 이름(보라색 박스) 클릭하면 해당 위치로 카카오 길찾기
      markerEl.addEventListener("click", (e) => {
        e.stopPropagation();

        const label = loc.address || uid; // 주소가 있으면 주소, 없으면 유저ID

        const url = `https://map.kakao.com/link/to/${encodeURIComponent(
          label
        )},${loc.lat},${loc.lng}`;

        window.open(url, "_blank");
      });

      const overlay = new window.kakao.maps.CustomOverlay({
        position: coord,
        content: markerEl,
        yAnchor: 2.5,
      });
      overlay.setMap(map);
      otherUserOverlays.current.push(overlay);
    });
  };

  /** 🔴 내 위치 실시간 추적 (빨간 동그라미, 나만 보임) **/
  useEffect(() => {
    if (!map || !currentUser) return;

    if (!navigator.geolocation) {
      console.warn("[DEBUG][GEO] ⚠️ 이 브라우저는 Geolocation 을 지원하지 않음");
      return;
    }

    let first = true;

    const success = (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const locPosition = new window.kakao.maps.LatLng(lat, lng);

      // 첫 위치 잡을 때만 화면 중앙으로 이동
      if (first) {
        map.setCenter(locPosition);
        first = false;
      }

      // 이미 내 위치 오버레이가 있으면 위치만 옮김
      if (myLocationOverlayRef.current) {
        myLocationOverlayRef.current.setPosition(locPosition);
        return;
      }

      // 🔴 빨간 원 엘리먼트 생성
      const markerEl = document.createElement("div");
      markerEl.style.cssText = `
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: red;
        border: 2px solid white;
        box-shadow: 0 0 4px rgba(255,0,0,0.8);
      `;

      const overlay = new window.kakao.maps.CustomOverlay({
        position: locPosition,
        content: markerEl,
        yAnchor: 0.5,
        xAnchor: 0.5,
        zIndex: 99999,
      });

      overlay.setMap(map);
      myLocationOverlayRef.current = overlay;
    };

    const error = (err) => {
      console.warn("[DEBUG][GEO] ⚠️ 위치 추적 실패:", err?.message);
    };

    // ✅ 실시간 추적
    const watchId = navigator.geolocation.watchPosition(success, error, {
      enableHighAccuracy: true,
      maximumAge: 5000,
      timeout: 10000,
    });
    myLocationWatchIdRef.current = watchId;

    // 클린업: 지도/유저 변경되거나 컴포넌트 언마운트 시 정리
    return () => {
      if (myLocationWatchIdRef.current != null) {
        navigator.geolocation.clearWatch(myLocationWatchIdRef.current);
        myLocationWatchIdRef.current = null;
      }
      if (myLocationOverlayRef.current) {
        myLocationOverlayRef.current.setMap(null);
        myLocationOverlayRef.current = null;
      }
    };
  }, [map, currentUser]);

  /** 로그인 UI **/
  if (!loggedIn)
    return (
      <div
        style={{
          height: "100vh",
          width: "100vw",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background:
            "linear-gradient(135deg, #2c3e50 0%, #4ca1af 50%, #2c3e50 100%)",
          fontFamily:
            "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        }}
      >
        <div
          style={{
            width: "320px",
            padding: "28px 26px 24px",
            borderRadius: "16px",
            background: "rgba(255,255,255,0.96)",
            boxShadow: "0 14px 45px rgba(0,0,0,0.25)",
            border: "1px solid rgba(255,255,255,0.7)",
            backdropFilter: "blur(10px)",
          }}
        >
          <div style={{ marginBottom: "18px", textAlign: "center" }}>
            <div
              style={{
                fontSize: "22px",
                fontWeight: 700,
                color: "#222",
                marginBottom: "6px",
              }}
            >
              계량기 지도 로그인
            </div>
            <div
              style={{
                fontSize: "12px",
                color: "#777",
              }}
            >
              아이디와 비밀번호를 입력해주세요
            </div>
          </div>

          <form onSubmit={handleLogin}>
            <div style={{ marginBottom: "10px" }}>
              <label
                style={{
                  display: "block",
                  fontSize: "12px",
                  fontWeight: 600,
                  color: "#444",
                  marginBottom: "4px",
                }}
              >
                아이디
              </label>
              <input
                value={user}
                onChange={(e) => setUser(e.target.value)}
                placeholder="아이디를 입력하세요"
                style={{
                  width: "100%",
                  padding: "9px 10px",
                  borderRadius: "8px",
                  border: "1px solid #d0d7de",
                  fontSize: "13px",
                  outline: "none",
                  boxSizing: "border-box",
                }}
                onFocus={(e) => (e.target.style.borderColor = "#4a90e2")}
                onBlur={(e) => (e.target.style.borderColor = "#d0d7de")}
              />
            </div>

            <div style={{ marginBottom: "14px" }}>
              <label
                style={{
                  display: "block",
                  fontSize: "12px",
                  fontWeight: 600,
                  color: "#444",
                  marginBottom: "4px",
                }}
              >
                비밀번호
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="비밀번호를 입력하세요"
                style={{
                  width: "100%",
                  padding: "9px 10px",
                  borderRadius: "8px",
                  border: "1px solid #d0d7de",
                  fontSize: "13px",
                  outline: "none",
                  boxSizing: "border-box",
                }}
                onFocus={(e) => (e.target.style.borderColor = "#4a90e2")}
                onBlur={(e) => (e.target.style.borderColor = "#d0d7de")}
              />
            </div>

            <button
              type="submit"
              style={{
                width: "100%",
                marginTop: "4px",
                padding: "10px 0",
                borderRadius: "999px",
                border: "none",
                background:
                  "linear-gradient(135deg, #4a90e2 0%, #007bff 100%)",
                color: "white",
                fontWeight: 700,
                fontSize: "14px",
                cursor: "pointer",
                boxShadow: "0 6px 15px rgba(0,123,255,0.35)",
              }}
            >
              로그인
            </button>
          </form>
        </div>
      </div>
    );

  /** 지도 UI **/
  return (
    <div style={{ width: "100%", height: "100vh", position: "relative" }}>
        {/* 왼쪽 상단 상태 카운트 + 마커 개수 필터 */}
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
      fontSize: "12px",

      // 🔽 여기 두 줄 추가 (전체 박스를 70% 크기로)
    transform: "scale(0.7)",
    transformOrigin: "top left",
    }}
  >
    {/* 상태 카운트 */}
    <div style={{ fontWeight: "bold", marginBottom: 6 }}>
      ✅ 완료: {counts["완료"] || 0} | ❌ 불가: {counts["불가"] || 0} | 🟦 미방문:{" "}
      {counts["미방문"] || 0}
    </div>

    {/* 마커 개수 필터 */}
    <div
      style={{
        marginTop: 4,
        paddingTop: 4,
        borderTop: "1px solid #eee",
      }}
    >
      <div style={{ marginBottom: 4, fontWeight: "bold" }}>마커 개수 필터</div>
      <div style={{ display: "flex", alignItems: "center" }}>
        <input
          type="number"
          min="1"
          value={minMarkerCount}
          onChange={(e) => setMinMarkerCount(e.target.value)}
          placeholder="예: 3"
          style={{
            width: "70px",
            padding: "3px 6px",
            fontSize: "12px",
            borderRadius: "4px",
            border: "1px solid #ccc",
            boxSizing: "border-box",
          }}
        />
        <button
          onClick={handleApplyFilter}
          style={{
            marginLeft: 6,
            padding: "4px 8px",
            fontSize: "12px",
            borderRadius: "4px",
            border: "none",
            background: "#007bff",
            color: "white",
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          필터
        </button>
      </div>
      <div style={{ marginTop: 2, fontSize: "11px", color: "#555" }}>
        비우면 전체 표시
      </div>
    </div>
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
