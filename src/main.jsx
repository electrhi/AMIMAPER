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

// ✅ 상태 옵션(필터용)
const STATUS_OPTIONS = ["완료", "불가", "미방문"];

// ✅ 계기 타입 매핑(기존 renderMarkers 안에 있던 내용 그대로 이동)
const METER_MAPPING = {
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

// ✅ meter_id → 계기타입
const getMeterType = (meterId) => {
  const id = String(meterId ?? "");
  const mid = id.substring(2, 4); // 기존 로직 유지
  return METER_MAPPING[mid] || "확인필요";
};


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

  // ✅ 상태 필터(다중 체크): [] 이면 "전체"로 취급
  const [statusFilters, setStatusFilters] = useState([...STATUS_OPTIONS]);

  // ✅ 계기타입 필터(다중 체크): [] 이면 "전체"로 취급
  const [meterTypeFilters, setMeterTypeFilters] = useState([]);

  // ✅ 현재 데이터에 존재하는 계기타입 목록(필터 UI용)
  const availableMeterTypes = React.useMemo(() => {
    const s = new Set();
    for (const r of data || []) {
      const t = getMeterType(r?.meter_id);
      if (t) s.add(t);
    }
    return Array.from(s).sort();
  }, [data]);

  // ✅ "표시/숨김이 바뀔 수 있는 필터"가 켜져 있나?
  const isStatusFilterActive =
    statusFilters.length > 0 && statusFilters.length < STATUS_OPTIONS.length;
  const isMeterTypeFilterActive = meterTypeFilters.length > 0;


  // ✅ 주소 라벨 ON/OFF
  const [showAddressLabels, setShowAddressLabels] = useState(true);

  // ✅ 미좌표(좌표 없는) 목록 모달
const [noCoordModalOpen, setNoCoordModalOpen] = useState(false);

// ✅ 좌표 없는 항목만 따로 모으기(중복 meter_id 제거)
const noCoordRows = React.useMemo(() => {
  const latest = new Map(); // meter_id -> row

  for (const r of data || []) {
    const mid = normalizeMeterId(r?.meter_id);
    if (!mid) continue;

    const latN = Number(r?.lat);
    const lngN = Number(r?.lng);

    // 좌표가 정상(finite)이면 제외
    if (Number.isFinite(latN) && Number.isFinite(lngN)) continue;

    // meter_id 중복 제거 (첫 1개만 유지)
    if (!latest.has(mid)) latest.set(mid, r);
  }

  const out = Array.from(latest.values());

  // 정렬: 리스트번호 -> 계기번호 -> 주소
  out.sort((a, b) => {
    const aList = String(a?.list_no ?? "");
    const bList = String(b?.list_no ?? "");
    const aNum = parseInt(aList, 10);
    const bNum = parseInt(bList, 10);

    if (!Number.isNaN(aNum) && !Number.isNaN(bNum) && aNum !== bNum) return aNum - bNum;
    if (aList !== bList) return aList.localeCompare(bList, "ko-KR", { numeric: true });

    const aMid = normalizeMeterId(a?.meter_id);
    const bMid = normalizeMeterId(b?.meter_id);
    if (aMid !== bMid) return aMid.localeCompare(bMid, "ko-KR", { numeric: true });

    return String(a?.address ?? "").localeCompare(String(b?.address ?? ""), "ko-KR");
  });

  return out;
}, [data]);


  // ✅ 검색창 (리스트번호/계기번호/주소)
  const [searchText, setSearchText] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchOpen, setSearchOpen] = useState(false);

  // ✅ 검색/필터 패널 열기 토글(UI만)
  const [searchPanelOpen, setSearchPanelOpen] = useState(false);
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);

  // ✅ 모바일 여부(터치 영역/패널 스케일 조절)
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 520);
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 520);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // ✅ 임의 마커 수정/삭제용 오버레이
  const customEditOverlayRef = useRef(null);
  const editingCustomIdRef = useRef(null);
  const customEditDraftRef = useRef(null);


  // ✅ 관리자 여부
  const isAdmin =
    currentUser?.can_view_others === true ||
    String(currentUser?.can_view_others || "").toLowerCase() === "y";


  // 🔴 내 위치(방향 화살표) 엘리먼트 ref
  const myLocationArrowElRef = useRef(null);

  // 🔴 내 위치 이전값 저장(방향 계산용)
  const myLastPosRef = useRef(null);
  const myLastHeadingRef = useRef(null);

  // ✅ 방위각 계산(0=북쪽, 90=동쪽)
  const calcBearing = (lat1, lon1, lat2, lon2) => {
    const toRad = (d) => (d * Math.PI) / 180;
    const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
    const x =
      Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
      Math.sin(toRad(lat1)) *
        Math.cos(toRad(lat2)) *
        Math.cos(toRad(lon2 - lon1));
    const brng = Math.atan2(y, x);
    return ((brng * 180) / Math.PI + 360) % 360;
  };


  console.log("[DEBUG][SUPABASE_URL]", SUPABASE_URL);

    // ➕ 임의 마커 추가 모드
  const [isAddMarkerMode, setIsAddMarkerMode] = useState(false);

  // 임의 마커 데이터(로컬 저장)
  const [customMarkers, setCustomMarkers] = useState([]);

  // 지도 위에 올려진 임의 마커 객체들 보관(삭제/재렌더용)
  const customMarkerObjsRef = useRef([]);

  // 드래그 중인 임시 마커(추가 모드에서 1개만)
  const draftMarkerRef = useRef(null);

  // 텍스트 입력 오버레이
  const customInputOverlayRef = useRef(null);

  // 로컬스토리지 키(유저+엑셀별로 분리)
  const CUSTOM_MARKERS_KEY = `amimap_custom_markers_${currentUser?.id || "anon"}_${currentUser?.data_file || "default"}`;


  // 예: 데이터 파일이 "djdemo.xlsx" 라면 geoCache 파일명은 "geoCache_djdemo.xlsx.json"
  const GEO_CACHE_FILE = `geoCache_${currentUser?.data_file || "default"}.json`;

  // 🔹 마커 오버레이들을 유지하기 위한 ref
  const markersRef = useRef([]);

  // ✅ (추가) "좌표/그룹"이 바뀌는 순간만 +1 (status 변경은 제외)
  const [layoutVersion, setLayoutVersion] = useState(0);

  // ✅ (추가) 좌표Key -> overlay, meter_id -> 좌표Key
  const overlayByKeyRef = useRef(new Map());
  const meterToKeyRef = useRef(new Map());

  // ✅ (추가) 전체 렌더를 디바운스로 요청하기 위한 장치
  const renderMarkersRefFn = useRef(null);
  const requestFullRender = useRef(
    debounce(() => {
      renderMarkersRefFn.current?.();
    }, 250)
  );


  // ✅ 최신 data를 이벤트 핸들러에서 안전하게 쓰기 위한 ref
const dataRef = useRef([]);
useEffect(() => {
  dataRef.current = data;
}, [data]);

  // ✅ 디버그: data 안의 lat/lng가 null인데 Number()가 0으로 바뀌는지 확인 (1번만)
useEffect(() => {
  if (!data || data.length === 0) return;

  // 너무 많이 찍히지 않게 1번만 찍기
  if (window.__printed_latlng_debug) return;
  window.__printed_latlng_debug = true;

  console.log("========== [LAT/LNG DEBUG START] ==========");
  console.log(
    data.slice(0, 20).map((r) => ({
      meter_id: r?.meter_id,
      lat_raw: r?.lat,
      lng_raw: r?.lng,
      lat_number: Number(r?.lat),
      lng_number: Number(r?.lng),
      lat_isFinite: Number.isFinite(Number(r?.lat)),
      lng_isFinite: Number.isFinite(Number(r?.lng)),
    }))
  );
  console.log("TOTAL rows:", data.length);
  console.log("========== [LAT/LNG DEBUG END] ==========");
}, [data]);


// ✅ status 변경으로 data가 바뀌어도 카운트는 항상 최신 유지 ✅✅✅
useEffect(() => {
  const next = { 완료: 0, 불가: 0, 미방문: 0 };

  for (const r of data || []) {
    next[r.status] = (next[r.status] || 0) + 1;
  }

  setCounts((prev) => {
    const same =
      prev.완료 === next.완료 &&
      prev.불가 === next.불가 &&
      prev.미방문 === next.미방문;
    return same ? prev : next;
  });
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

  const dataFile = currentUser?.data_file;
  if (!dataFile) return; // ✅ 여기서 한번만 체크

  const seq = ++metersFetchSeqRef.current;
  const columns = "meter_id,status,updated_at";

  let rows = [];
  for (const part of chunkArray(ids, 500)) {
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

  // ✅ (추가) status만 바뀐 경우: 전체 renderMarkers 말고 해당 마커 색만 업데이트
  updateMarkerColorsByMeterIds(ids, latest);
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
      requestFullRender.current();
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

 useEffect(() => {
  if (!map || !window.kakao?.maps) return;
  if (!currentUser?.data_file) return; // ✅ 추가: data_file 없으면 동기화하지 않음

  const syncInView = async () => {
    console.count("[DEBUG][FETCH] sync in view");

    const b = map.getBounds();
    const sw = b.getSouthWest();
    const ne = b.getNorthEast();

    const swLat = sw.getLat();
    const swLng = sw.getLng();
    const neLat = ne.getLat();
    const neLng = ne.getLng();

    const visibleIds = [];
    for (const row of dataRef.current) {
      const latN = Number(row?.lat);
      const lngN = Number(row?.lng);
      if (!Number.isFinite(latN) || !Number.isFinite(lngN)) continue;

      if (latN >= swLat && latN <= neLat && lngN >= swLng && lngN <= neLng) {
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

  debounced();

  return () => {
    window.kakao.maps.event.removeListener(map, "dragend", onDragEnd);
    window.kakao.maps.event.removeListener(map, "zoom_changed", onZoomChanged);
  };
}, [map, currentUser?.data_file]); // ✅ 변경



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

        requestFullRender.current();
      } catch (err) {
        console.error("[ERROR][CACHE] 캐시 로드 실패:", err.message);
      }
    };

    loadGeoCache();
  }, [loggedIn, currentUser]);

    // ✅ 임의 마커 로드
  useEffect(() => {
    if (!currentUser) return;
    try {
      const raw = localStorage.getItem(CUSTOM_MARKERS_KEY);
      if (raw) setCustomMarkers(JSON.parse(raw));
      else setCustomMarkers([]);
    } catch (e) {
      console.warn("[WARN][CUSTOM] 마커 로드 실패:", e?.message);
      setCustomMarkers([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id, currentUser?.data_file]);

  // ✅ 임의 마커 저장
  useEffect(() => {
    if (!currentUser) return;
    try {
      localStorage.setItem(CUSTOM_MARKERS_KEY, JSON.stringify(customMarkers));
    } catch (e) {
      console.warn("[WARN][CUSTOM] 마커 저장 실패:", e?.message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customMarkers, currentUser?.id, currentUser?.data_file]);


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
    requestFullRender.current();
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

  // ✅ 현재 화면(bounds) 안에 있는 meter_id 전부 뽑기 (좌표 있는 것만)
const getVisibleMeterIds = () => {
  if (!map) return [];

  const b = map.getBounds();
  const sw = b.getSouthWest();
  const ne = b.getNorthEast();

  const swLat = sw.getLat();
  const swLng = sw.getLng();
  const neLat = ne.getLat();
  const neLng = ne.getLng();

  const ids = [];
  for (const row of dataRef.current) {
    const latN = Number(row?.lat);
    const lngN = Number(row?.lng);
    if (!Number.isFinite(latN) || !Number.isFinite(lngN)) continue;

    if (
      latN >= swLat && latN <= neLat &&
      lngN >= swLng && lngN <= neLng
    ) {
      ids.push(row.meter_id);
    }
  }


  return Array.from(new Set(ids.map(normalizeMeterId))).filter(Boolean);
};

  // ✅ 검색 결과로 이동
const moveToSearchResult = async (item) => {
  if (!map || !window.kakao?.maps) return;

  const lat = Number(item?.lat);
  const lng = Number(item?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

  const p = new window.kakao.maps.LatLng(lat, lng);

  // 너무 멀리서 검색했을 때만 적당히 확대(기존 사용자 줌을 최대한 존중)
  try {
    const cur = map.getLevel();
    if (cur > 5) map.setLevel(5);
  } catch {}

  map.panTo(p);

  setSearchOpen(false);
  setSearchPanelOpen(false); // ✅ 검색 결과 클릭 시 검색 패널도 같이 닫

  // 이동 후 화면 내 최신 상태 동기화(기존 로직 재사용)
  setTimeout(() => {
    try {
      fetchLatestStatus();
    } catch {}
  }, 350);

  // 모바일 키보드 닫기
  try {
    document.activeElement?.blur?.();
  } catch {}
};

// ✅ 검색 실행
const runSearch = () => {
  const qRaw = (searchText || "").trim();
  if (!qRaw) {
    setSearchResults([]);
    setSearchOpen(false);
    return;
  }

  const qList = qRaw; // 리스트번호는 원문 기준 includes
  const qMeter = normalizeMeterId(qRaw); // 계기번호는 normalize 기준
  const qAddr = qRaw.replace(/\s+/g, "").toLowerCase(); // 주소는 공백 제거 + 소문자

  // 최신 per meter만(중복 방지)
  const latestPerMeter = new Map();
  for (const r of dataRef.current || []) {
    const mid = normalizeMeterId(r?.meter_id);
    if (!mid) continue;
    if (!latestPerMeter.has(mid)) latestPerMeter.set(mid, r);
  }

  const matches = [];
  for (const r of latestPerMeter.values()) {
    const listNo = String(r?.list_no ?? "").trim();
    const meter = normalizeMeterId(r?.meter_id);
    const addr = String(r?.address ?? "").trim();
    const addrNorm = addr.replace(/\s+/g, "").toLowerCase();

    const hit =
      (listNo && listNo.includes(qList)) ||
      (meter && qMeter && meter.includes(qMeter)) ||
      (addrNorm && qAddr && addrNorm.includes(qAddr));

    if (hit) matches.push(r);
  }

  const matchedTotal = matches.length;

  // 같은 마커(같은 좌표)로 묶기 (좌표 없는 건 제외)
  const byKey = new Map();
  for (const r of matches) {
    const latN = Number(r?.lat);
    const lngN = Number(r?.lng);
    if (!Number.isFinite(latN) || !Number.isFinite(lngN)) continue;

    const key = `${latN},${lngN}`;
    const prev = byKey.get(key);
    if (!prev) byKey.set(key, { row: { ...r, lat: latN, lng: lngN }, count: 1 });
    else prev.count += 1;
  }


  const results = Array.from(byKey.values()).map((x) => ({
    key: `${x.row.lat},${x.row.lng}`,
    lat: Number(x.row.lat),
    lng: Number(x.row.lng),
    address: x.row.address,
    meter_id: x.row.meter_id,
    list_no: x.row.list_no,
    count: x.count,
  }));

  results.sort((a, b) => b.count - a.count);

  setSearchResults(results);
  setSearchOpen(true);

  if (results.length === 1) {
    moveToSearchResult(results[0]);
    return;
  }

  if (results.length === 0) {
    if (matchedTotal > 0) alert("검색 결과는 있지만 좌표가 없어 이동할 수 없습니다.");
    else alert("검색 결과가 없습니다.");
    setSearchOpen(false);
  }
};


  // ✅ 상태 필터/주소라벨 토글 바뀌면 지도 다시 반영
  useEffect(() => {
  if (!map) return;
  requestFullRender.current();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilters, meterTypeFilters, showAddressLabels]);


  // ✅ 검색 결과 바깥 클릭 시 닫기
  useEffect(() => {
    const onDocDown = (e) => {
      const root = document.getElementById("amimap-searchbox");
      if (!root) return;
      if (!root.contains(e.target)) setSearchOpen(false);
    };
    document.addEventListener("pointerdown", onDocDown);
    return () => document.removeEventListener("pointerdown", onDocDown);
  }, []);



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

    // ✅ status -> 색
  const statusToColor = (s) =>
    s === "완료" ? "green" : s === "불가" ? "red" : "blue";

  // ✅ overlay 색상만 변경
  const setOverlayColor = (overlay, status) => {
    const el = overlay?.getContent?.();
    if (!el) return;
    el.style.background = statusToColor(status);
    el.style.transition = "background 0.3s ease";
  };

  // ✅ (추가) meterIds가 속한 마커들만 찾아서 색만 업데이트
  const updateMarkerColorsByMeterIds = (meterIds, latestMap = null) => {
    if (!meterIds || meterIds.length === 0) return;

    // ⚠️ 상태/계기타입 필터가 켜져 있으면 표시/숨김이 바뀔 수 있으니 전체 렌더가 안전
    if (isStatusFilterActive || isMeterTypeFilterActive) {
      requestFullRender.current();
      return;
    }


    const keys = new Set();
    for (const id of meterIds) {
      const key = meterToKeyRef.current.get(normalizeMeterId(id));
      if (key) keys.add(key);
    }

    for (const key of keys) {
      const ov = overlayByKeyRef.current.get(key);
      if (!ov) continue;

      // 이 마커에 묶인 계기들 중 아무거나 최신 status를 하나 찾음
      let st = null;
      const mids = ov.__meterIds || [];

      for (const mid of mids) {
        const norm = normalizeMeterId(mid);
        const r = (latestMap && latestMap.get(norm)) || metersCacheRef.current.get(norm);
        if (r?.status) { st = r.status; break; }
      }

      if (!st && mids[0]) {
        const row = dataRef.current.find(
          (d) => normalizeMeterId(d.meter_id) === normalizeMeterId(mids[0])
        );
        st = row?.status;
      }

      if (st) setOverlayColor(ov, st);
    }
  };


  const renderMarkersPartial = (coords, newStatus) => {
  const RADIUS = 1000; // 1km
  const lat = Number(coords.lat);
  const lng = Number(coords.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

  let updatedCount = 0;

  markersRef.current.forEach((overlay) => {
    const mLat = Number(overlay.__lat);
    const mLng = Number(overlay.__lng);

    if (!Number.isFinite(mLat) || !Number.isFinite(mLng)) return;

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

    // ✅ 좌표/그룹(레이아웃)이 바뀐 순간만 전체 렌더 필요 신호
    setLayoutVersion((v) => v + 1);
    
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

      // ✅ (추가) 인덱스 초기화
      overlayByKeyRef.current.clear();
      meterToKeyRef.current.clear();

      // 🔹 기존 주소 라벨 제거
      addressOverlaysRef.current.forEach((ov) => ov.setMap(null));
      addressOverlaysRef.current = [];

      const grouped = {};
      
      // ✅ meter_id 기준 최신 데이터만 유지 (counts는 useEffect([data])가 담당)
      const latestPerMeter = {};
      data.forEach((d) => {
        if (!latestPerMeter[d.meter_id]) latestPerMeter[d.meter_id] = d;
      });
      
      const filteredData = Object.values(latestPerMeter);
      // ✅ [] 이면 전체로 취급
      const statusSet = statusFilters.length ? new Set(statusFilters) : null;
      const typeSet = meterTypeFilters.length ? new Set(meterTypeFilters) : null;
      
      const filteredForMap = filteredData.filter((r) => {
        const okStatus = !statusSet || statusSet.has(r.status);
        const okType = !typeSet || typeSet.has(getMeterType(r.meter_id));
        return okStatus && okType;
      });



      console.log(
        `[DEBUG][MAP] ✅ 데이터 정제 완료 — ${filteredForMap.length}건 처리 중...`
      );

      // 좌표 기준 그룹핑
      const uniqueGroupSet = new Set();
      for (const row of filteredForMap) {
        const address = row?.address;
        const latN = Number(row?.lat);
        const lngN = Number(row?.lng);

        if (!address || !Number.isFinite(latN) || !Number.isFinite(lngN)) continue;
        
        const cleanAddr = address.trim().replace(/\s+/g, " ");
        const key = `${latN},${lngN}`;
        
        const uniqueKey = `${cleanAddr}_${row.meter_id}`;
        if (uniqueGroupSet.has(uniqueKey)) continue;
        uniqueGroupSet.add(uniqueKey);

        if (!grouped[key]) grouped[key] = { coords: { lat: latN, lng: lngN }, list: [] };
        grouped[key].list.push(row);
      }


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

        // ✅ Partial 업데이트용 좌표 박아두기 (무조건 숫자로 고정)
        overlay.__lat = Number(coords.lat);
        overlay.__lng = Number(coords.lng);

        // ✅ (추가) 이 마커가 어떤 계기들을 포함하는지 저장 + 인덱스 등록
        overlay.__key = key;
        overlay.__meterIds = list.map((r) => normalizeMeterId(r.meter_id));

        overlayByKeyRef.current.set(key, overlay);
        for (const r of list) {
          meterToKeyRef.current.set(normalizeMeterId(r.meter_id), key);
        }

        overlay.setMap(map);
        markersRef.current.push(overlay);

        markerCount++;

        // 🔹 현재 지도 레벨 기준으로 라벨 표시 여부 결정
        const currentLevel = map.getLevel();
        const showLabel = showAddressLabels && currentLevel <= LABEL_SHOW_LEVEL;

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
          // ✅ 어떤 마커를 클릭하든 "현재 화면 내 전체"를 최신화
          await fetchLatestStatus();


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

            const type = getMeterType(id);

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
      return;
    }

    await updateStatus(list.map((g) => g.meter_id), text, coords);
    await loadOtherUserLocations();
  });

  popupEl.appendChild(btn); // ✅ 이거 빠지면 버튼이 안 뜸
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

        markerEl.addEventListener("pointerdown", openPopup);
      });

      console.log(`[DEBUG][MAP] ✅ 마커 ${markerCount}개 렌더링 완료`);
    } catch (e) {
      console.error("[ERROR][MAP] 마커 렌더링 실패:", e);
    }
  };

  // ✅ (추가) 디바운스 요청이 항상 최신 renderMarkers를 부르게 연결
  useEffect(() => {
    renderMarkersRefFn.current = renderMarkers;
  });

    const clearCustomMarkerObjects = () => {
    customMarkerObjsRef.current.forEach((o) => {
      try { o.marker?.setMap(null); } catch {}
      try { o.label?.setMap(null); } catch {}
    });
    customMarkerObjsRef.current = [];
  };

  const renderCustomMarkers = () => {
    if (!map || !window.kakao?.maps) return;

    clearCustomMarkerObjects();

    customMarkers.forEach((m) => {
      const coord = new window.kakao.maps.LatLng(m.lat, m.lng);

      const marker = new window.kakao.maps.Marker({
        position: coord,
        draggable: false,
      });
      marker.setMap(map);

      const labelEl = document.createElement("div");
      labelEl.style.cssText = `
        background: rgba(255,255,255,0.95);
        border: 1px solid #ddd;
        border-radius: 8px;
        padding: 4px 6px;
        font-size: 12px;
        box-shadow: 0 2px 6px rgba(0,0,0,0.15);
        white-space: nowrap;
        transform: translateY(-6px);
        pointer-events: none;
      `;
      labelEl.textContent = m.text || "";

      const label = new window.kakao.maps.CustomOverlay({
        position: coord,
        content: labelEl,
        yAnchor: 1.9,
        zIndex: 999998,
      });
      if (m.text) label.setMap(map);
      // ✅ label 생성 후 다시 click 편집 등록(이제 label 포함)
      window.kakao.maps.event.addListener(marker, "click", () => {
        openCustomMarkerEditor({ id: m.id, marker, label });
      });

      // ✅ 편집 중인 임의 마커를 드래그로 옮겼을 때 좌표 임시 저장 + 편집창/라벨 위치 갱신
      window.kakao.maps.event.addListener(marker, "dragend", () => {
        if (editingCustomIdRef.current !== m.id) return;

        const p = marker.getPosition();
        const lat = p.getLat();
        const lng = p.getLng();

        const draft = customEditDraftRef.current || {};
        customEditDraftRef.current = { ...draft, lat, lng };

        // 편집 오버레이 따라가기
        if (customEditOverlayRef.current) {
          try { customEditOverlayRef.current.setPosition(p); } catch {}
        }

        // 라벨도 따라가기(보이는 경우)
        if (label) {
          try { label.setPosition(p); } catch {}
        }
      });

      customMarkerObjsRef.current.push({ id: m.id, marker, label });
    });
  };

  // ✅ customMarkers 바뀔 때마다 지도에 반영
  useEffect(() => {
    if (!map) return;
    renderCustomMarkers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, customMarkers]);

  const closeCustomInputOverlay = () => {
    if (customInputOverlayRef.current) {
      try { customInputOverlayRef.current.setMap(null); } catch {}
      customInputOverlayRef.current = null;
    }
  };

  const closeCustomEditOverlay = () => {
  if (customEditOverlayRef.current) {
    try { customEditOverlayRef.current.setMap(null); } catch {}
    customEditOverlayRef.current = null;
  }
  editingCustomIdRef.current = null;
  customEditDraftRef.current = null;
};

const openCustomMarkerEditor = (markerObj) => {
  if (!map || !window.kakao?.maps) return;

  closeCustomEditOverlay();

  const { id, marker, label } = markerObj || {};
  const current = customMarkers.find((m) => m.id === id);
  if (!current || !marker) return;

  editingCustomIdRef.current = id;
  customEditDraftRef.current = { ...current }; // lat/lng/text 임시 저장

  const pos = marker.getPosition();

  const box = document.createElement("div");
  box.style.cssText = `
    background: white;
    border: 1px solid #ccc;
    border-radius: 12px;
    padding: 10px;
    width: ${isMobile ? "260px" : "230px"};
    box-shadow: 0 2px 12px rgba(0,0,0,0.22);
    font-size: ${isMobile ? "13px" : "12px"};
  `;

  const title = document.createElement("div");
  title.textContent = "임의 마커 편집";
  title.style.cssText = "font-weight:800; margin-bottom:8px;";
  box.appendChild(title);

  const input = document.createElement("input");
  input.type = "text";
  input.value = current.text || "";
  input.placeholder = "텍스트(비우면 라벨 숨김)";
  input.style.cssText = `
    width: 100%;
    padding: 10px 10px;
    border-radius: 10px;
    border: 1px solid #ddd;
    outline: none;
    box-sizing: border-box;
    font-size: ${isMobile ? "14px" : "13px"};
  `;
  box.appendChild(input);

  const hint = document.createElement("div");
  hint.style.cssText = "margin-top:6px; color:#666; line-height:1.3;";
  hint.textContent = "‘위치 이동’ 누른 뒤 드래그 → ‘저장’";
  box.appendChild(hint);

  const row = document.createElement("div");
  row.style.cssText = "display:flex; gap:8px; margin-top:10px;";

  const btnStyle = `
    flex:1;
    padding: ${isMobile ? "12px 10px" : "10px 10px"};
    border-radius: 10px;
    border: none;
    font-weight: 800;
    cursor: pointer;
  `;

  let moving = false;

  const moveBtn = document.createElement("button");
  moveBtn.textContent = "위치 이동";
  moveBtn.style.cssText = btnStyle + "background:#222; color:#fff;";
  moveBtn.onclick = (e) => {
    e.stopPropagation();
    moving = !moving;
    try { marker.setDraggable(moving); } catch {}
    moveBtn.textContent = moving ? "이동 중..." : "위치 이동";
    moveBtn.style.opacity = moving ? "0.8" : "1";
  };

  const saveBtn = document.createElement("button");
  saveBtn.textContent = "저장";
  saveBtn.style.cssText = btnStyle + "background:#007bff; color:white;";
  saveBtn.onclick = (e) => {
    e.stopPropagation();

    const draft = customEditDraftRef.current || current;
    const nextText = (input.value || "").trim();

    // 저장(텍스트/위치)
    setCustomMarkers((prev) =>
      prev.map((m) =>
        m.id === id
          ? { ...m, text: nextText, lat: draft.lat, lng: draft.lng }
          : m
      )
    );

    // 드래그 종료
    try { marker.setDraggable(false); } catch {}

    closeCustomEditOverlay();
  };

  row.appendChild(moveBtn);
  row.appendChild(saveBtn);
  box.appendChild(row);

  const row2 = document.createElement("div");
  row2.style.cssText = "display:flex; gap:8px; margin-top:8px;";

  const delBtn = document.createElement("button");
  delBtn.textContent = "삭제";
  delBtn.style.cssText = btnStyle + "background:#dc3545; color:white;";
  delBtn.onclick = (e) => {
    e.stopPropagation();
    closeCustomEditOverlay();
    setCustomMarkers((prev) => prev.filter((m) => m.id !== id));
  };

  const closeBtn = document.createElement("button");
  closeBtn.textContent = "닫기";
  closeBtn.style.cssText = btnStyle + "background:#f1f3f5; color:#222; border:1px solid #ddd;";
  closeBtn.onclick = (e) => {
    e.stopPropagation();
    try { marker.setDraggable(false); } catch {}
    closeCustomEditOverlay();
  };

  row2.appendChild(delBtn);
  row2.appendChild(closeBtn);
  box.appendChild(row2);

  const ov = new window.kakao.maps.CustomOverlay({
    position: pos,
    content: box,
    yAnchor: 1.35,
    zIndex: 999999,
  });
  ov.setMap(map);
  customEditOverlayRef.current = ov;

  setTimeout(() => input.focus(), 0);
};


  const openCustomTextEditor = (position, onSave) => {
    closeCustomInputOverlay();

    const box = document.createElement("div");
    box.style.cssText = `
      background: white;
      border: 1px solid #ccc;
      border-radius: 10px;
      padding: 8px;
      width: 220px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.2);
      font-size: 12px;
    `;

    const title = document.createElement("div");
    title.textContent = "메모 입력";
    title.style.cssText = "font-weight:700; margin-bottom:6px;";
    box.appendChild(title);

    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "예: 누수 의심, 재방문 필요...";
    input.style.cssText = `
      width: 100%;
      padding: 7px 8px;
      border-radius: 8px;
      border: 1px solid #ddd;
      outline: none;
      box-sizing: border-box;
    `;
    box.appendChild(input);

    const btnRow = document.createElement("div");
    btnRow.style.cssText =
      "display:flex; gap:6px; margin-top:8px; justify-content:flex-end;";

    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "취소";
    cancelBtn.style.cssText = `
      padding: 6px 10px;
      border-radius: 8px;
      border: 1px solid #ddd;
      background: #fff;
      cursor: pointer;
    `;
    cancelBtn.onclick = (e) => {
      e.stopPropagation();
      closeCustomInputOverlay();
    };

    const saveBtn = document.createElement("button");
    saveBtn.textContent = "저장";
    saveBtn.style.cssText = `
      padding: 6px 10px;
      border-radius: 8px;
      border: none;
      background: #007bff;
      color: white;
      cursor: pointer;
      font-weight: 700;
    `;
    saveBtn.onclick = (e) => {
      e.stopPropagation();
      const text = (input.value || "").trim();
      onSave(text);
      closeCustomInputOverlay();
    };

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(saveBtn);
    box.appendChild(btnRow);

    const ov = new window.kakao.maps.CustomOverlay({
      position,
      content: box,
      yAnchor: 1.8,
      zIndex: 999999,
    });
    ov.setMap(map);
    customInputOverlayRef.current = ov;

    setTimeout(() => input.focus(), 0);
  };

  const cleanupDraftMarker = () => {
    if (draftMarkerRef.current) {
      try { draftMarkerRef.current.setMap(null); } catch {}
      draftMarkerRef.current = null;
    }
    closeCustomInputOverlay();
  };

  // ✅ (변경) "좌표/그룹이 바뀌는 순간(layoutVersion)"에만 전체 renderMarkers 실행
  useEffect(() => {
    if (!map || !window.kakao?.maps) return;
    if (layoutVersion === 0) return; // 아직 좌표 매칭 전

    requestFullRender.current(); // 디바운스로 전체 렌더 요청
  }, [map, layoutVersion]);


  // 🔹 줌 레벨에 따라 주소 라벨 토글
  useEffect(() => {
    if (!map || typeof window.kakao === "undefined") return;

    const handler = () => {
      const level = map.getLevel();
      const show = showAddressLabels && level <= LABEL_SHOW_LEVEL;

      addressOverlaysRef.current.forEach((ov) => {
        ov.setMap(show ? map : null);
      });
    };

    window.kakao.maps.event.addListener(map, "zoom_changed", handler);

    // cleanup
    return () => {
      window.kakao.maps.event.removeListener(map, "zoom_changed", handler);
    };
  }, [map, showAddressLabels]);

    // ➕ 추가 모드: 지도 클릭 → 임시 마커 생성(드래그 가능), 마커 다시 클릭 → 고정 + 텍스트 입력
  useEffect(() => {
    if (!map || !window.kakao?.maps) return;

    const onMapClick = (mouseEvent) => {
      if (!isAddMarkerMode) return;

      // 이미 임시 마커가 있으면(드래그 중이면) 지도 클릭은 무시
      if (draftMarkerRef.current) return;

      const pos = mouseEvent.latLng;

      const marker = new window.kakao.maps.Marker({
        position: pos,
        draggable: true,
      });
      marker.setMap(map);
      
      draftMarkerRef.current = marker;
      

      // “마커를 한번 더 누르면” → 고정 + 텍스트 입력
      window.kakao.maps.event.addListener(marker, "click", () => {
        const fixedPos = marker.getPosition();

        marker.setDraggable(false);

        openCustomTextEditor(fixedPos, (text) => {
          const lat = fixedPos.getLat();
          const lng = fixedPos.getLng();

          const id =
            (window.crypto?.randomUUID && window.crypto.randomUUID()) ||
            String(Date.now());

          setCustomMarkers((prev) => [...prev, { id, lat, lng, text }]);

          // 임시 마커 제거(실제 마커는 renderCustomMarkers가 렌더)
          cleanupDraftMarker();
        });
      });
    };

    window.kakao.maps.event.addListener(map, "click", onMapClick);

    return () => {
      window.kakao.maps.event.removeListener(map, "click", onMapClick);
    };
  }, [map, isAddMarkerMode]);


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

      // ✅ 2) user_last_locations는 "유저 마지막 위치" (유저당 1행 유지)
const lastAddress = payload[0]?.address || "";

const { error: lastLocError } = await supabase
  .from("user_last_locations")
  .upsert(
    {
      data_file: currentUser.data_file,
      user_id: currentUser.id,
      address: lastAddress,
      lat: parseFloat(coords.lat),
      lng: parseFloat(coords.lng),
      status: newStatus,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "data_file,user_id" }
  )
  .select("user_id"); // ✅ 응답 최소화

// ✅ 임시 해결: view라서 저장이 실패할 수 있으니, throw 하지 말고 경고만 찍고 계속 진행
if (lastLocError) {
  console.warn(
    "[WARN][LASTLOC] user_last_locations 저장 실패(무시):",
    lastLocError.message
  );
}

console.log("[DEBUG][STATUS] ✅ DB 업데이트 완료:", payload);

// ✅ 화면 즉시 반영(낙관적 업데이트)
const idSet = new Set(meterIds.map(normalizeMeterId));
setData((prev) =>
  prev.map((r) =>
    idSet.has(normalizeMeterId(r.meter_id))
      ? { ...r, status: newStatus }
      : r
  )
);

// ✅ 최신 상태는 "방금 업데이트한 계기들만" 반영 (1번만)
await fetchLatestStatus(payload.map((p) => p.meter_id));

// ✅ 전체 재렌더 대신 "이번에 바꾼 meterIds가 속한 마커"만 색상 업데이트
const tmpLatest = new Map(
  payload.map((p) => [p.meter_id, { status: newStatus }])
);
updateMarkerColorsByMeterIds(payload.map((p) => p.meter_id), tmpLatest);


// ✅ 선택: 보통은 제거 추천 (data 변경으로 렌더가 다시 일어나는 편)
// setTimeout(() => renderMarkers(), 0);

const overlay = getActiveOverlay();
if (overlay) {
  overlay.setMap(null);
  setActiveOverlay(null);
}

console.log("[DEBUG][STATUS] 🔁 전체 지도 최신화 완료");

    } catch (e) {
      console.error("[ERROR][STATUS] 저장 실패:", e.message);
    }
  };

/** ✅ 다른 사용자 마지막 위치 불러오기
 *  - 관리자(isAdmin): data_file 무시하고 전체 유저의 "마지막 위치"만 표시
 *  - (user_last_locations에 data_file별로 행이 여러개 있을 수 있으니 user_id별 최신 1개로 압축)
 */
const loadOtherUserLocations = async () => {
  if (!map) return;
  if (!isAdmin) return;

  otherUserOverlays.current.forEach((ov) => ov.setMap(null));
  otherUserOverlays.current = [];

  const { data: rows, error } = await supabase
    .from("user_last_locations")
    .select("user_id,data_file,address,lat,lng,status,updated_at")
    .not("user_id", "is", null)
    .order("updated_at", { ascending: false })
    .limit(5000);

  if (error) {
    console.error("[ERROR][OTHERS] user_last_locations:", error.message);
    return;
  }

  console.log("[DEBUG][OTHERS] fetched rows:", rows?.length || 0);

  const latestByUser = new Map();
  for (const loc of rows || []) {
    if (!loc?.user_id) continue;
    if (loc.lat == null || loc.lng == null) continue;
    if (!latestByUser.has(loc.user_id)) latestByUser.set(loc.user_id, loc);
  }

  for (const loc of latestByUser.values()) {
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
      cursor:pointer;
    `;

    markerEl.textContent = loc.user_id; // ✅ 빠져있던 핵심
    markerEl.title = loc.data_file ? `파일: ${loc.data_file}` : "";

    markerEl.addEventListener("click", (e) => {
      e.stopPropagation();
      const label = loc.address || loc.user_id;
      const url = `https://map.kakao.com/link/to/${encodeURIComponent(label)},${loc.lat},${loc.lng}`;
      window.open(url, "_blank");
    });

    const overlay = new window.kakao.maps.CustomOverlay({
      position: coord,
      content: markerEl,
      yAnchor: 2.5,
    });

    overlay.setMap(map);
    otherUserOverlays.current.push(overlay);
  }
};


  // ✅ 관리자면 지도 준비된 뒤 다른 유저 위치 1회 로드
useEffect(() => {
  if (!map) return;
  if (!isAdmin) return;
  loadOtherUserLocations();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [map, isAdmin]);


  /** 🔴 내 위치 실시간 추적 (진행방향 화살표, 나만 보임) **/
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

      // ✅ heading(기기 제공) 우선 사용, 없으면 이전 위치로 계산
      let heading = Number.isFinite(pos.coords.heading) ? pos.coords.heading : null;

      const prev = myLastPosRef.current;
      if (heading == null && prev) {
        // 너무 작은 이동은 노이즈가 많아서 방향 유지
        const moved = distanceInMeters(prev.lat, prev.lng, lat, lng);
        if (moved > 2) heading = calcBearing(prev.lat, prev.lng, lat, lng);
      }

      if (heading == null) heading = myLastHeadingRef.current;
      if (heading != null) myLastHeadingRef.current = heading;

      myLastPosRef.current = { lat, lng };

      // 이미 내 위치 오버레이가 있으면 위치만 옮기고, 방향만 갱신
      if (myLocationOverlayRef.current) {
        myLocationOverlayRef.current.setPosition(locPosition);
        if (myLocationArrowElRef.current && heading != null) {
          myLocationArrowElRef.current.style.transform = `rotate(${heading}deg)`;
        }
        return;
      }

      // 🧭 화살표 엘리먼트 생성 (CSS 삼각형)
      const wrapper = document.createElement("div");
      wrapper.style.cssText = `
        width: 28px;
        height: 28px;
        display: flex;
        align-items: center;
        justify-content: center;
        pointer-events: none;
      `;

      const arrow = document.createElement("div");
      arrow.style.cssText = `
        width: 0;
        height: 0;
        border-left: 7px solid transparent;
        border-right: 7px solid transparent;
        border-bottom: 14px solid red; /* 기본은 북쪽(위) 방향 */
        filter: drop-shadow(0 0 3px rgba(0,0,0,0.35));
        transform-origin: 50% 60%;
      `;

      if (heading != null) arrow.style.transform = `rotate(${heading}deg)`;

      wrapper.appendChild(arrow);
      myLocationArrowElRef.current = arrow;

      const overlay = new window.kakao.maps.CustomOverlay({
        position: locPosition,
        content: wrapper,
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

    const watchId = navigator.geolocation.watchPosition(success, error, {
      enableHighAccuracy: true,
      maximumAge: 5000,
      timeout: 10000,
    });
    myLocationWatchIdRef.current = watchId;

    return () => {
      if (myLocationWatchIdRef.current != null) {
        navigator.geolocation.clearWatch(myLocationWatchIdRef.current);
        myLocationWatchIdRef.current = null;
      }
      if (myLocationOverlayRef.current) {
        myLocationOverlayRef.current.setMap(null);
        myLocationOverlayRef.current = null;
      }
      myLocationArrowElRef.current = null;
      myLastPosRef.current = null;
      myLastHeadingRef.current = null;
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

      {/* 🔎 검색 패널(버튼 눌렀을 때만 표시) */}
{searchPanelOpen && (
  <div
    style={{
      position: "fixed",
      inset: 0,
      zIndex: 1000000,
      background: "rgba(0,0,0,0.25)",
      display: "flex",
      justifyContent: "center",
      alignItems: "flex-start",
      paddingTop: 12,
    }}
    onClick={() => {
      setSearchPanelOpen(false);
      setSearchOpen(false);
    }}
  >
    <div
      id="amimap-searchbox"
      style={{
        width: isMobile ? "92vw" : "520px",
        maxWidth: "520px",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          background: "rgba(255,255,255,0.98)",
          padding: isMobile ? "12px 12px" : "10px 12px",
          borderRadius: "14px",
          boxShadow: "0 2px 12px rgba(0,0,0,0.22)",
          border: "1px solid rgba(0,0,0,0.08)",
        }}
      >
        <input
          value={searchText}
          onChange={(e) => {
            setSearchText(e.target.value);
            const v = (e.target.value || "").trim();
            if (!v) setSearchOpen(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") runSearch();
          }}
          placeholder="리스트번호 / 계기번호 / 주소 검색"
          style={{
            flex: 1,
            padding: isMobile ? "14px 12px" : "12px 12px",
            borderRadius: "12px",
            border: "1px solid #ddd",
            outline: "none",
            fontSize: isMobile ? "16px" : "14px",
            boxSizing: "border-box",
          }}
        />

        {searchText?.trim() && (
          <button
            onClick={() => {
              setSearchText("");
              setSearchResults([]);
              setSearchOpen(false);
            }}
            style={{
              padding: isMobile ? "14px 12px" : "12px 12px",
              borderRadius: "12px",
              border: "1px solid #ddd",
              background: "#fff",
              cursor: "pointer",
              fontWeight: 900,
              fontSize: isMobile ? "14px" : "12px",
              whiteSpace: "nowrap",
            }}
          >
            ✕
          </button>
        )}

        <button
          onClick={runSearch}
          style={{
            padding: isMobile ? "14px 14px" : "12px 12px",
            borderRadius: "12px",
            border: "none",
            background: "#007bff",
            color: "white",
            cursor: "pointer",
            fontWeight: 900,
            fontSize: isMobile ? "14px" : "12px",
            whiteSpace: "nowrap",
          }}
        >
          검색
        </button>

        <button
          onClick={() => {
            setSearchPanelOpen(false);
            setSearchOpen(false);
          }}
          style={{
            padding: isMobile ? "14px 12px" : "12px 12px",
            borderRadius: "12px",
            border: "1px solid #ddd",
            background: "#fff",
            cursor: "pointer",
            fontWeight: 900,
            fontSize: isMobile ? "14px" : "12px",
            whiteSpace: "nowrap",
          }}
        >
          닫기
        </button>
      </div>

      {searchOpen && searchResults.length > 1 && (
        <div
          style={{
            marginTop: 8,
            background: "rgba(255,255,255,0.98)",
            border: "1px solid rgba(0,0,0,0.08)",
            borderRadius: "14px",
            boxShadow: "0 2px 12px rgba(0,0,0,0.18)",
            overflow: "hidden",
            maxHeight: isMobile ? "55vh" : "360px",
            overflowY: "auto",
          }}
        >
          {searchResults.slice(0, 25).map((r) => (
            <button
              key={r.key}
              onClick={() => moveToSearchResult(r)}
              style={{
                width: "100%",
                textAlign: "left",
                border: "none",
                background: "transparent",
                cursor: "pointer",
                padding: isMobile ? "14px 12px" : "12px 12px",
                borderBottom: "1px solid rgba(0,0,0,0.06)",
              }}
            >
              <div style={{ fontWeight: 900, fontSize: isMobile ? "15px" : "13px" }}>
                {r.address || "(주소 없음)"} {r.count > 1 ? `(+${r.count - 1})` : ""}
              </div>
              <div style={{ marginTop: 3, color: "#666", fontSize: isMobile ? "13px" : "11px" }}>
                리스트번호: {r.list_no || "-"} · 계기번호: {r.meter_id || "-"}
              </div>
            </button>
          ))}
          {searchResults.length > 25 && (
            <div style={{ padding: "10px 12px", fontSize: "12px", color: "#666" }}>
              결과가 많아 25개까지만 표시합니다. 검색어를 더 구체적으로 입력해주세요.
            </div>
          )}
        </div>
      )}
    </div>
  </div>
)}

      {/* ⚙️ 마커 개수 필터 패널(버튼 눌렀을 때만 표시) */}
{filterPanelOpen && (
  <div
    style={{
      position: "fixed",
      inset: 0,
      zIndex: 1000000,
      background: "rgba(0,0,0,0.25)",
      display: "flex",
      justifyContent: "center",
      alignItems: "flex-start",
      paddingTop: 70,
    }}
    onClick={() => setFilterPanelOpen(false)}
  >
    <div
      style={{
        width: isMobile ? "92vw" : "380px",
        background: "rgba(255,255,255,0.98)",
        borderRadius: "14px",
        boxShadow: "0 2px 12px rgba(0,0,0,0.22)",
        border: "1px solid rgba(0,0,0,0.08)",
        padding: "12px",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div style={{ fontWeight: 900, fontSize: isMobile ? "16px" : "14px", marginBottom: 10 }}>
        마커 개수 필터
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          type="number"
          min="1"
          value={minMarkerCount}
          onChange={(e) => setMinMarkerCount(e.target.value)}
          placeholder="예: 3"
          style={{
            flex: 1,
            padding: isMobile ? "14px 12px" : "12px 10px",
            fontSize: isMobile ? "16px" : "14px",
            borderRadius: "12px",
            border: "1px solid #ccc",
            boxSizing: "border-box",
          }}
        />

        <button
          onClick={() => {
            handleApplyFilter();
            setFilterPanelOpen(false);
          }}
          style={{
            padding: isMobile ? "14px 14px" : "12px 12px",
            fontSize: isMobile ? "14px" : "12px",
            borderRadius: "12px",
            border: "none",
            background: "#007bff",
            color: "white",
            cursor: "pointer",
            fontWeight: 900,
            whiteSpace: "nowrap",
          }}
        >
          적용
        </button>

        <button
          onClick={() => setFilterPanelOpen(false)}
          style={{
            padding: isMobile ? "14px 12px" : "12px 12px",
            fontSize: isMobile ? "14px" : "12px",
            borderRadius: "12px",
            border: "1px solid #ddd",
            background: "#fff",
            cursor: "pointer",
            fontWeight: 900,
            whiteSpace: "nowrap",
          }}
        >
          닫기
        </button>
      </div>

      <div style={{ marginTop: 8, fontSize: isMobile ? "13px" : "12px", color: "#555" }}>
        비우면 전체 표시
      </div>

      <div style={{ marginTop: 14, borderTop: "1px solid rgba(0,0,0,0.08)", paddingTop: 12 }}>
        <div style={{ fontWeight: 900, fontSize: isMobile ? "16px" : "14px", marginBottom: 8 }}>
          계기 타입 필터
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            onClick={() => setMeterTypeFilters([])}
            style={{
              padding: isMobile ? "10px 10px" : "7px 8px",
              borderRadius: "10px",
              border: "1px solid #ddd",
              background: meterTypeFilters.length === 0 ? "#f1f3f5" : "#fff",
              fontWeight: 900,
              cursor: "pointer",
              fontSize: isMobile ? "13px" : "12px",
            }}
          >
            전체
          </button>

          {availableMeterTypes.map((t) => {
            const checked = meterTypeFilters.length === 0 || meterTypeFilters.includes(t);

            const toggle = () => {
              setMeterTypeFilters((prev) => {
                const base = prev.length === 0 ? [...availableMeterTypes] : [...prev];
                const has = base.includes(t);
                const next = has ? base.filter((x) => x !== t) : [...base, t];
                return next;
              });
            };

            return (
              <label
                key={t}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  cursor: "pointer",
                  userSelect: "none",
                  padding: isMobile ? "10px 10px" : "7px 8px",
                  borderRadius: "10px",
                  border: "1px solid rgba(0,0,0,0.08)",
                  background: checked ? "#f1f3f5" : "#fff",
                  fontWeight: 900,
                }}
              >
                <input type="checkbox" checked={checked} onChange={toggle} style={{ width: 16, height: 16 }} />
                <span style={{ fontSize: isMobile ? "14px" : "12px" }}>{t}</span>
              </label>
            );
          })}
        </div>

        <div style={{ marginTop: 8, fontSize: isMobile ? "13px" : "12px", color: "#555" }}>
          아무것도 선택 안 하면 전체 표시
        </div>
      </div>
    </div>
  </div>
)}

      {/* 🧾 미좌표 목록 모달 */}
{noCoordModalOpen && (
  <div
    style={{
      position: "fixed",
      inset: 0,
      zIndex: 1000000,
      background: "rgba(0,0,0,0.25)",
      display: "flex",
      justifyContent: "center",
      alignItems: "flex-start",
      paddingTop: 70,
    }}
    onClick={() => setNoCoordModalOpen(false)}
  >
    <div
      style={{
        width: isMobile ? "92vw" : "640px",
        maxWidth: "640px",
        background: "rgba(255,255,255,0.98)",
        borderRadius: "14px",
        boxShadow: "0 2px 12px rgba(0,0,0,0.22)",
        border: "1px solid rgba(0,0,0,0.08)",
        padding: "12px",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ fontWeight: 900, fontSize: isMobile ? "16px" : "14px" }}>
          미좌표 목록 ({noCoordRows.length})
        </div>

        <button
          onClick={() => setNoCoordModalOpen(false)}
          style={{
            padding: isMobile ? "12px 12px" : "10px 12px",
            borderRadius: "12px",
            border: "1px solid #ddd",
            background: "#fff",
            cursor: "pointer",
            fontWeight: 900,
            fontSize: isMobile ? "14px" : "12px",
            whiteSpace: "nowrap",
          }}
        >
          닫기
        </button>
      </div>

      <div style={{ marginTop: 10, fontSize: isMobile ? "13px" : "12px", color: "#666" }}>
        (리스트번호 | 계기번호 | 주소)
      </div>

      <div
        style={{
          marginTop: 10,
          maxHeight: isMobile ? "70vh" : "520px",
          overflowY: "auto",
          border: "1px solid rgba(0,0,0,0.08)",
          borderRadius: "12px",
          background: "white",
        }}
      >
        {noCoordRows.length === 0 ? (
          <div style={{ padding: "12px", color: "#666", fontSize: isMobile ? "14px" : "12px" }}>
            미좌표 항목이 없습니다.
          </div>
        ) : (
          noCoordRows.map((r, idx) => (
            <div
              key={`${normalizeMeterId(r?.meter_id)}_${idx}`}
              style={{
                padding: isMobile ? "12px 12px" : "10px 12px",
                borderBottom: "1px solid rgba(0,0,0,0.06)",
                fontSize: isMobile ? "14px" : "12px",
                lineHeight: 1.35,
                wordBreak: "break-word",
              }}
            >
              {String(r?.list_no ?? "-")} | {String(r?.meter_id ?? "-")} | {String(r?.address ?? "-")}
            </div>
          ))
        )}
      </div>
    </div>
  </div>
)}



      {/* 왼쪽 상단 상태 카운트 + 검색/필터 */}
<div
  style={{
    position: "fixed",
    top: 10,
    left: 10,
    background: "white",
    padding: isMobile ? "10px 12px" : "8px 12px",
    borderRadius: "10px",
    boxShadow: "0 2px 8px rgba(0,0,0,0.18)",
    zIndex: 999999,
    fontSize: isMobile ? "13px" : "12px",
    transform: `scale(${isMobile ? 0.665 : 0.546})`,
    transformOrigin: "top left",
  }}
>
  {/* ✅ 1행: 완료/불가/미방문 (3칸) */}
  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
    {STATUS_OPTIONS.map((s) => {
      const active = statusFilters.length === 0 || statusFilters.includes(s);

      const toggle = () => {
        setStatusFilters((prev) => {
          const base = prev.length === 0 ? [...STATUS_OPTIONS] : [...prev];
          const has = base.includes(s);
          const next = has ? base.filter((x) => x !== s) : [...base, s];
          return next; // []이면 전체로 취급(렌더Markers에서 statusSet=null)
        });
      };

      return (
        <button
          key={s}
          onClick={toggle}
          style={{
            width: "100%",
            padding: isMobile ? "10px 10px" : "7px 8px",
            borderRadius: "10px",
            border: "1px solid rgba(0,0,0,0.08)",
            background: active ? "#f1f3f5" : "#fff",
            fontWeight: 900,
            cursor: "pointer",
            fontSize: isMobile ? "14px" : "12px",
            whiteSpace: "nowrap",
          }}
        >
          {s} : {counts[s] || 0}
        </button>
      );
    })}
  </div>

  {/* ✅ 2행: 전체 / 주소ON (3칸 중 2칸 사용) */}
  <div
    style={{
      marginTop: 8,
      display: "grid",
      gridTemplateColumns: "repeat(3, 1fr)",
      gap: 8,
    }}
  >
    <button
      onClick={() => setStatusFilters([...STATUS_OPTIONS])}
      style={{
        width: "100%",
        padding: isMobile ? "10px 10px" : "7px 8px",
        borderRadius: "10px",
        border: "1px solid #ddd",
        background: "#fff",
        fontWeight: 900,
        cursor: "pointer",
        fontSize: isMobile ? "14px" : "12px",
        whiteSpace: "nowrap",
      }}
    >
      전체
    </button>

    <button
      onClick={() => setShowAddressLabels((v) => !v)}
      style={{
        width: "100%",
        padding: isMobile ? "10px 10px" : "7px 8px",
        borderRadius: "10px",
        border: "1px solid #ddd",
        background: showAddressLabels ? "#f1f3f5" : "#fff",
        fontWeight: 900,
        cursor: "pointer",
        fontSize: isMobile ? "14px" : "12px",
        whiteSpace: "nowrap",
      }}
    >
      주소{showAddressLabels ? "ON" : "OFF"}
    </button>

    {/* 3번째 칸은 비워둠(원하면 여기다 다른 버튼/표시 추가 가능) */}
    <button
  onClick={() => {
    setSearchPanelOpen(false);
    setSearchOpen(false);
    setFilterPanelOpen(false);
    setNoCoordModalOpen(true);
  }}
  style={{
    width: "100%",
    padding: isMobile ? "10px 10px" : "7px 8px",
    borderRadius: "10px",
    border: "1px solid #ddd",
    background: noCoordRows.length ? "#fff" : "#f8f9fa",
    fontWeight: 900,
    cursor: "pointer",
    fontSize: isMobile ? "14px" : "12px",
    whiteSpace: "nowrap",
  }}
>
  미좌표 {noCoordRows.length}
</button>
  </div>

  {/* ✅ 3행: 검색 / 필터 (2칸) */}
  <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
    <button
      onClick={() => {
        setFilterPanelOpen(false);
        setSearchPanelOpen(true);
        setTimeout(() => {
          try {
            document
              .getElementById("amimap-searchbox")
              ?.querySelector("input")
              ?.focus?.();
          } catch {}
        }, 0);
      }}
      style={{
        width: "100%",
        padding: isMobile ? "10px 10px" : "7px 8px",
        borderRadius: "10px",
        border: "1px solid #ddd",
        background: "#fff",
        fontWeight: 900,
        cursor: "pointer",
        fontSize: isMobile ? "14px" : "12px",
        whiteSpace: "nowrap",
      }}
    >
     🔎 검색
    </button>

    <button
      onClick={() => {
        setSearchPanelOpen(false);
        setSearchOpen(false);
        setFilterPanelOpen(true);
      }}
      style={{
        width: "100%",
        padding: isMobile ? "10px 10px" : "7px 8px",
        borderRadius: "10px",
        border: "1px solid #ddd",
        background: "#fff",
        fontWeight: 900,
        cursor: "pointer",
        fontSize: isMobile ? "14px" : "12px",
        whiteSpace: "nowrap",
      }}
    >
     ⚙️ 필터
    </button>
  </div>
</div>


      {/* ➕ 임의 마커 추가 버튼 (오른쪽 상단) */}
      <button
        onClick={() => {
          setIsAddMarkerMode((v) => {
            const next = !v;
            if (!next) cleanupDraftMarker(); // 끌 때 임시 마커/입력창 정리
            return next;
          });
        }}
        style={{
          position: "fixed",
          top: 14,
          right: 14,
          zIndex: 999999,
          padding: "10px 14px",
          borderRadius: "10px",
          border: "none",
          background: isAddMarkerMode ? "#dc3545" : "#28a745",
          color: "white",
          cursor: "pointer",
          fontWeight: 800,
          boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
        }}
      >
        {isAddMarkerMode ? "✕ 추가 취소" : "➕ 추가"}
      </button>

      {isAddMarkerMode && (
        <div
          style={{
            position: "fixed",
            top: 58,
            right: 14,
            zIndex: 999999,
            background: "rgba(255,255,255,0.95)",
            border: "1px solid #ddd",
            borderRadius: "10px",
            padding: "8px 10px",
            fontSize: "12px",
            boxShadow: "0 2px 8px rgba(0,0,0,0.18)",
            lineHeight: 1.35,
          }}
        >
          1) 지도 클릭 → 임시 마커 생성<br />
          2) 드래그로 위치 조정<br />
          3) 마커 다시 클릭 → 텍스트 입력/저장
        </div>
      )}

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
