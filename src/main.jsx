import React, { useEffect, useState, useRef } from "react";
import ReactDOM from "react-dom/client";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

// 환경변수 로드 확인 디버그
console.log("[SYSTEM] 환경변수 로드 상태 확인:");
console.log("- URL:", import.meta.env.VITE_SUPABASE_URL ? "OK" : "MISSING");
console.log("- KEY:", import.meta.env.VITE_SUPABASE_KEY ? "OK" : "MISSING");
console.log("- KAKAO:", import.meta.env.VITE_KAKAO_JAVASCRIPT_KEY ? "OK" : "MISSING");

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

  // 예: 데이터 파일이 "djdemo.xlsx" 라면 geoCache 파일명은 "geoCache_djdemo.xlsx.json"
  const GEO_CACHE_FILE = `geoCache_${currentUser?.data_file || "default"}.json`;

  // 렌더링 중에 유지되는 전역 비슷한 배열
  let markers = [];
  let activeOverlay = null;

  const getActiveOverlay = () => window.__activeOverlayRef || null;
  const setActiveOverlay = (ov) => (window.__activeOverlayRef = ov);

  /** 🔐 수동 로그인 처리 **/
  const handleLogin = async (e) => {
    e.preventDefault();
    console.group("[DEBUG][LOGIN] 수동 로그인 프로세스 시작");
    console.log("1. 입력된 ID:", user);
    console.time("LoginQueryTime");

    const { data: users, error } = await supabase
      .from("users")
      .select("*")
      .eq("id", user);

    console.timeEnd("LoginQueryTime");

    if (error) {
      console.error("❌ Supabase 쿼리 오류:", error.message, error.details);
      console.groupEnd();
      return alert("로그인 오류 발생: " + error.message);
    }

    if (users && users.length > 0) {
      console.log("2. 사용자 찾음:", users[0]);
      if (users[0].password === password) {
        const userData = users[0];
        console.log("✅ 비밀번호 일치. 로그인 성공.");

        // ✅ 로컬에 user id 저장 → 다음 접속 시 자동 로그인에 사용
        try {
          localStorage.setItem("amimap_user_id", userData.id);
          console.log("💾 로컬스토리지에 사용자 ID 저장 완료:", userData.id);
        } catch (err) {
          console.warn("⚠️ 로컬스토리지 저장 실패(브라우저 설정 확인 필요):", err?.message);
        }

        setCurrentUser(userData);
        await loadData(userData.data_file);
        setLoggedIn(true);
      } else {
        console.warn("❌ 비밀번호 불일치");
        alert("비밀번호가 틀렸습니다.");
      }
    } else {
      console.warn("❌ 해당 ID의 사용자가 없음");
      alert("존재하지 않는 아이디입니다.");
    }
    console.groupEnd();
  };

  /** 🔐 앱 시작 시 자동 로그인 시도 **/
  useEffect(() => {
    const autoLogin = async () => {
      if (loggedIn) {
        return;
      }

      console.group("[DEBUG][AUTH] 자동 로그인 체크");
      let savedId = null;
      try {
        savedId = localStorage.getItem("amimap_user_id");
      } catch (err) {
        console.warn("⚠️ 로컬스토리지 접근 불가:", err?.message);
      }

      if (!savedId) {
        console.log("ℹ️ 저장된 사용자 ID 없음 — 로그인 화면 대기");
        console.groupEnd();
        return;
      }

      console.log("🔄 저장된 ID 발견:", savedId, "→ 정보 조회 시도");

      const { data: users, error } = await supabase
        .from("users")
        .select("*")
        .eq("id", savedId);

      if (error) {
        console.error("❌ 자동 로그인 쿼리 오류:", error.message);
        console.groupEnd();
        return;
      }

      if (!users || users.length === 0) {
        console.warn("⚠️ 저장된 ID가 서버에 존재하지 않음 → 로컬 정보 삭제");
        try {
          localStorage.removeItem("amimap_user_id");
        } catch {}
        console.groupEnd();
        return;
      }

      const userData = users[0];
      console.log("✅ 자동 로그인 성공:", userData.id);

      setCurrentUser(userData);
      await loadData(userData.data_file);
      setLoggedIn(true);
      console.groupEnd();
    };

    autoLogin();
  }, [loggedIn]);

  /** Excel 데이터 로드 **/
  const loadData = async (fileName) => {
    try {
      console.group(`[DEBUG][DATA] 엑셀 데이터 로드: ${fileName}`);
      console.time("ExcelDownload");
      
      const { data: excelBlob, error } = await supabase.storage
        .from("excels")
        .download(fileName);
        
      console.timeEnd("ExcelDownload");

      if (error) {
        console.error("❌ 엑셀 다운로드 실패:", error);
        throw error;
      }
      
      console.log(`📦 파일 다운로드 완료. 크기: ${(excelBlob.size / 1024 / 1024).toFixed(2)} MB`);

      console.time("ExcelParsing");
      const blob = await excelBlob.arrayBuffer();
      const workbook = XLSX.read(blob, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(sheet);
      console.timeEnd("ExcelParsing");
      
      console.log(`📊 엑셀 파싱 완료: 총 ${json.length.toLocaleString()} 행`);

      const baseData = json.map((r) => ({
        meter_id: r["계기번호"],
        address: r["주소"],
        status: r["진행"] || "미방문",
      }));

      console.log("🔄 DB에서 최신 작업 상태 동기화 중...");
      console.time("StatusSync");
      const { data: dbData, error: dbError } = await supabase
        .from("meters")
        .select("*")
        .order("updated_at", { ascending: false });
        
      if(dbError) console.error("⚠️ 상태 동기화 쿼리 에러(무시 가능):", dbError.message);
      console.timeEnd("StatusSync");

      const latestMap = {};
      dbData?.forEach((d) => {
        if (!latestMap[d.meter_id]) latestMap[d.meter_id] = d;
      });

      const merged = baseData.map((x) => {
        const m = latestMap[x.meter_id];
        return m ? { ...x, status: m.status } : x;
      });

      setData(merged);
      console.log(`✅ 최종 데이터 병합 완료: ${merged.length.toLocaleString()}건`);
      console.groupEnd();
      
      setTimeout(() => renderMarkers(), 400);
    } catch (e) {
      console.error("❌ [CRITICAL] 데이터 로드 프로세스 중단:", e.message);
      console.groupEnd();
      alert("데이터를 불러오는데 실패했습니다. 콘솔을 확인해주세요.");
    }
  };

  /** Kakao 지도 초기화 **/
  useEffect(() => {
    if (!loggedIn) return;
    
    // 이미 지도가 있으면 스킵
    if (map) return;

    console.log("[DEBUG][MAP] 🗺️ Kakao 지도 SDK 스크립트 로드 시작");

    const script = document.createElement("script");
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_KEY}&autoload=false&libraries=services`;
    script.onload = () => {
      console.log("[DEBUG][MAP] SDK 스크립트 로드 완료. window.kakao.maps.load 실행");
      window.kakao.maps.load(() => {
        const mapContainer = document.getElementById("map");
        if(!mapContainer) {
            console.error("[DEBUG][MAP] ❌ 지도 컨테이너(#map)를 찾을 수 없습니다.");
            return;
        }
        
        const mapInstance = new window.kakao.maps.Map(
          mapContainer,
          {
            center: new window.kakao.maps.LatLng(37.5665, 126.9780),
            level: 5,
          }
        );
        console.log("[DEBUG][MAP] ✅ 지도 인스턴스 생성 완료");
        setMap(mapInstance);
      });
    };
    script.onerror = () => {
        console.error("[DEBUG][MAP] ❌ Kakao 지도 스크립트 로드 실패. API 키나 네트워크를 확인하세요.");
    };
    document.head.appendChild(script);
  }, [loggedIn]);

  /** Supabase에서 geoCache 파일 로드 (지오코딩 결과 JSON) **/
  useEffect(() => {
    if (!loggedIn || !currentUser) return;

    const loadGeoCache = async () => {
      try {
        console.group(`[DEBUG][CACHE] 지오캐시 파일 로드: ${GEO_CACHE_FILE}`);
        const { data: cacheBlob, error } = await supabase.storage
          .from("excels")
          .download(GEO_CACHE_FILE);

        if (error) {
          console.warn("⚠️ 캐시 파일 없음 (신규 생성 필요 또는 경로 확인):", error.message);
          setGeoCache({});
          console.groupEnd();
          return;
        }

        console.log(`📦 Blob 수신 완료: ${cacheBlob.size.toLocaleString()} bytes`);
        console.time("CacheParse");

        const arrayBuffer = await cacheBlob.arrayBuffer();
        const decoder = new TextDecoder("utf-8");
        const text = decoder.decode(arrayBuffer);
        
        let parsed;
        try {
          parsed = JSON.parse(text);
        } catch (err) {
          console.error("❌ JSON 파싱 실패 (파일 깨짐 의심):", err.message);
          console.groupEnd();
          return;
        }

        // 중첩 구조 해제 로직
        let unwrapDepth = 0;
        while (
          Object.keys(parsed).length === 1 &&
          typeof parsed[Object.keys(parsed)[0]] === "object"
        ) {
          parsed = parsed[Object.keys(parsed)[0]];
          unwrapDepth++;
        }
        if (unwrapDepth > 0) console.log(`ℹ️ JSON 구조 ${unwrapDepth}단계 벗겨냄`);

        const cleanedCache = {};
        Object.entries(parsed).forEach(([k, v]) => {
          // 공백 정규화
          const cleanKey = k.trim().replace(/\s+/g, " ");
          cleanedCache[cleanKey] = v;
        });

        console.timeEnd("CacheParse");
        console.log(`✅ 캐시 로드 완료: ${Object.keys(cleanedCache).length.toLocaleString()}개 주소`);
        
        setGeoCache(cleanedCache);
        console.groupEnd();

        setTimeout(() => renderMarkers(), 800);
      } catch (err) {
        console.error("❌ [ERROR][CACHE] 캐시 처리 중 예외 발생:", err.message);
        console.groupEnd();
      }
    };

    loadGeoCache();
  }, [loggedIn, currentUser]);

  /** 주소 → 좌표 변환 (Python 캐시만 사용, Kakao 지오코딩 호출 X) **/
  const geocodeAddress = async (address) => {
    // 로직 유지 (사용되지 않더라도)
    if (!address || address.trim() === "") return null;
    if (geoCache[address]) return geoCache[address];
    return null;
  };

  /** 지도 타입 전환 **/
  const toggleMapType = () => {
    if (!map) return;
    const newType = mapType === "ROADMAP" ? "HYBRID" : "ROADMAP";
    console.log(`[DEBUG][UI] 지도 타입 변경 요청: ${mapType} -> ${newType}`);
    map.setMapTypeId(
      newType === "ROADMAP"
        ? window.kakao.maps.MapTypeId.ROADMAP
        : window.kakao.maps.MapTypeId.HYBRID
    );
    setMapType(newType);
  };

  /** 최신 상태 가져오기 (DB 읽기 - 클릭 시 사용) **/
  const fetchLatestStatus = async () => {
    try {
      console.log("[DEBUG][SYNC] ☁️ 클릭 시점 최신 상태 동기화 시작");
      const { data: fresh, error } = await supabase
        .from("meters")
        .select("*")
        .order("updated_at", { ascending: false });
        
      if (error) {
          console.error("[DEBUG][SYNC] ❌ 동기화 실패:", error.message);
          throw error;
      }

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
      console.log("[DEBUG][SYNC] ✅ 동기화 완료");
      return updated;
    } catch (err) {
      console.error("[DEBUG][SYNC] 상태 갱신 예외:", err.message);
      return data;
    }
  };

  // ✅ 거리 계산 함수 (미터 단위)
  const distanceInMeters = (lat1, lon1, lat2, lon2) => {
    const R = 6371000;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  // ✅ 클릭한 지점 반경 1km 이내 마커들만 색상 업데이트 (빠른 버전)
  const renderMarkersPartial = (coords, newStatus) => {
    console.time("PartialRender");
    const RADIUS = 1000;
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

        el.style.background = color;
        el.style.transition = "background 0.3s ease";
        updatedCount++;
      }
    });
    console.timeEnd("PartialRender");
    console.log(`[DEBUG][MAP] 🟢 반경 1km 내 ${updatedCount}개 마커 색상 즉시 변경 완료`);
  };

  /** ✅ geoCache 매칭 (엑셀 address ↔ JSON 좌표) **/
  useEffect(() => {
    if (!geoCache || Object.keys(geoCache).length === 0) return;
    if (!data || data.length === 0) return;

    console.group("[DEBUG][GEO] 주소-좌표 매칭 알고리즘 시작");
    console.time("GeoMatching");

    const normalize = (str) =>
      str
        ?.toString()
        .trim()
        .replace(/\s+/g, " ")
        .replace(/\u3000/g, " ")
        .replace(/\r|\n|\t/g, "")
        .replace(/번지/g, "")
        .replace(/ /g, "");

    // 캐시 키 정규화 전처리
    const normalizedCacheEntries = Object.entries(geoCache).map(([k, v]) => [
      normalize(k),
      v,
    ]);

    let matchedCount = 0;
    const failedSamples = [];

    const matchedData = data.map((row, idx) => {
      const addr = normalize(row.address);
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

      // 3단계: 비슷한 문자열
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
      if (failedSamples.length < 5) {
        failedSamples.push({
          excel_addr: row.address,
          normalized: addr,
          status: "매칭 실패"
        });
      }

      return { ...row, lat: null, lng: null };
    });

    console.timeEnd("GeoMatching");
    console.log(`📊 매칭 결과: ${matchedCount} / ${matchedData.length} (${((matchedCount/matchedData.length)*100).toFixed(1)}%)`);
    
    if (failedSamples.length > 0) {
      console.log("⚠️ 매칭 실패 샘플 (상위 5개):", failedSamples);
    }
    console.groupEnd();

    setData(matchedData);
  }, [geoCache]);

  /** 마커 렌더링 **/
  const renderMarkers = async () => {
    try {
      if (!map || !data.length) {
        return; // 준비 안됨
      }

      console.group("[DEBUG][RENDER] 마커 렌더링 프로세스");
      console.time("MarkerRender");

      // 기존 마커 제거
      markers.forEach((m) => m.setMap(null));
      markers = [];

      const grouped = {};
      const statusCount = { 완료: 0, 불가: 0, 미방문: 0 };

      // meter_id 기준 최신 데이터만 유지
      const latestPerMeter = {};
      data.forEach((d) => {
        statusCount[d.status] = (statusCount[d.status] || 0) + 1;
        if (!latestPerMeter[d.meter_id]) latestPerMeter[d.meter_id] = d;
      });
      const filteredData = Object.values(latestPerMeter);

      setCounts((prev) => {
        const same =
          prev.완료 === statusCount.완료 &&
          prev.불가 === statusCount.불가 &&
          prev.미방문 === statusCount.미방문;
        return same ? prev : statusCount;
      });

      console.log(`ℹ️ 데이터 요약: 총 ${filteredData.length}건 유니크 계량기`);

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
        "17": "E-Type", "18": "E-Type", "19": "Adv-E",
        "25": "G-Type", "26": "G-Type", "27": "G-Type",
        "45": "G-Type", "46": "G-Type", "47": "G-Type",
        "01": "표준형", "03": "표준형", "14": "표준형", "15": "표준형",
        "34": "표준형", "35": "표준형",
        "51": "AMIGO", "52": "AMIGO", "53": "AMIGO", "54": "AMIGO",
        "55": "AMIGO", "56": "AMIGO", "57": "AMIGO",
      };

      let markerCount = 0;
      const groupKeys = Object.keys(grouped);
      console.log(`ℹ️ 좌표 그룹(마커) 수: ${groupKeys.length}개`);

      groupKeys.forEach((key) => {
        const { coords, list } = grouped[key];
        const 진행 = list[0].status;
        const color =
          진행 === "완료" ? "green" : 진행 === "불가" ? "red" : "blue";

        const kakaoCoord = new window.kakao.maps.LatLng(
          coords.lat,
          coords.lng
        );

        // 🎨 [수정됨] 마커 크기 70%로 축소 (30px -> 22px)
        const markerEl = document.createElement("div");
        markerEl.style.cssText = `
          background:${color};
          border-radius:50%;
          width:22px; height:22px;
          color:white; font-size:10px;
          line-height:22px; text-align:center;
          box-shadow:0 0 4px rgba(0,0,0,0.4);
          cursor:pointer;
          font-weight:bold;
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

        // 마커 클릭 시 팝업 + 상태 버튼
        const openPopup = async (e) => {
          console.log("[DEBUG][INTERACTION] 마커 클릭됨:", list[0].address);
          e.stopPropagation();
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
          `;
          
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
            }
          });
          popupEl.appendChild(closeBtn);

          const title = document.createElement("b");
          title.textContent = list[0].address;
          popupEl.appendChild(title);
          popupEl.appendChild(document.createElement("br"));
          popupEl.appendChild(document.createElement("br"));

          // 🆕 [추가됨] 계기번호 끝 2자리 중복 확인 로직
          // 1. 모든 ID의 끝 2자리를 추출하여 카운트
          const suffixCounts = {};
          const allIds = list.map((g) => String(g.meter_id).trim());
          allIds.forEach(id => {
              const suffix = id.slice(-2);
              suffixCounts[suffix] = (suffixCounts[suffix] || 0) + 1;
          });

          // 2. 화면에 표시할 유니크 ID 목록 (완전 똑같은 ID가 중복 출력되는 것 방지)
          const uniqueIds = Array.from(new Set(allIds));

          uniqueIds.forEach((id) => {
            const div = document.createElement("div");
            const mid = id.substring(2, 4);
            const type = meter_mapping[mid] || "확인필요";
            const suffix = id.slice(-2);

            div.textContent = `${id} | ${type}`;
            
            // 🆕 만약 이 끝 2자리를 가진 계기번호가 해당 마커 내에 2개 이상이라면 빨간색
            if (suffixCounts[suffix] > 1) {
                div.style.color = "red";
                div.style.fontWeight = "bold";
            }
            popupEl.appendChild(div);
          });

          popupEl.appendChild(document.createElement("hr"));

          ["완료", "불가", "미방문", "가기"].forEach((text) => {
            const btn = document.createElement("button");
            btn.textContent = text;
            btn.style.margin = "4px";
            btn.addEventListener("click", async (e) => {
              e.stopPropagation();
              console.log(`[DEBUG][ACTION] 버튼 클릭: ${text}`);
              if (text === "가기") {
                const url = `https://map.kakao.com/link/to/${encodeURIComponent(
                  list[0].address
                )},${coords.lat},${coords.lng}`;
                window.open(url, "_blank");
              } else {
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
            yAnchor: 1.1, 
            zIndex: 10000,
          });
          popupOverlay.setMap(map);
          setActiveOverlay(popupOverlay);
        };

        markerEl.addEventListener("click", openPopup);
        markerEl.addEventListener("touchstart", openPopup);
      });

      console.timeEnd("MarkerRender");
      console.log(`✅ 마커 렌더링 완료: 총 ${markerCount}개 오버레이 생성`);
      console.groupEnd();

    } catch (e) {
      console.error("[DEBUG][MAP] ❌ 마커 렌더링 중 치명적 오류:", e);
      console.groupEnd();
    }
  };

  /** ✅ 마커 렌더링 자동 트리거 **/
  useEffect(() => {
    let checkCount = 0;
    const maxWait = 100; // 대기 시간 증가 (대량 데이터 고려)

    const waitForReady = async () => {
      checkCount++;

      // Kakao SDK 로드 확인
      if (typeof window.kakao === "undefined" || !window.kakao.maps) {
        if (checkCount % 10 === 0) console.log(`⏳ SDK 대기중... (${checkCount}/${maxWait})`);
        if (checkCount < maxWait) return setTimeout(waitForReady, 100);
        console.error("❌ SDK 로드 타임아웃");
        return;
      }

      const ready =
        map instanceof window.kakao.maps.Map &&
        data.length > 0 &&
        Object.keys(geoCache).length > 0;

      if (!ready) {
        if (checkCount <= maxWait) {
          // 너무 자주 찍히지 않게 2초마다 상태 로그
          if (checkCount % 20 === 0) {
            console.log(
              `[DEBUG][WAIT] 렌더링 대기중... Map:${!!map}, Data:${data.length}, Cache:${Object.keys(geoCache).length}`
            );
          }
          return setTimeout(waitForReady, 100);
        } else {
          console.warn("⚠️ 준비 타임아웃: 데이터나 맵 로드가 너무 오래 걸립니다.");
          return;
        }
      }

      console.log("🚀 모든 조건 충족! 마커 렌더링 시작");
      await renderMarkers();
    };

    waitForReady();
  }, [map, data, geoCache]);

  /** 상태 업데이트 (버튼 클릭 시만 DB 업로드) **/
  const updateStatus = async (meterIds, newStatus, coords) => {
    try {
      console.group("[DEBUG][UPDATE] 상태 업데이트 트랜잭션");
      console.log(`- 대상: ${meterIds.length}개 계량기 (${meterIds.join(", ")})`);
      console.log(`- 변경할 상태: ${newStatus}`);

      const payload = meterIds.map((id) => ({
        meter_id: id,
        address: data.find((d) => d.meter_id === id)?.address || "",
        status: newStatus,
        user_id: currentUser.id,
        lat: parseFloat(coords.lat),
        lng: parseFloat(coords.lng),
        updated_at: new Date().toISOString(),
      }));

      console.time("DBUpdate");
      const { error: upsertError } = await supabase.from("meters").upsert(
        payload,
        {
          onConflict: ["meter_id", "address"],
        }
      );
      console.timeEnd("DBUpdate");

      if (upsertError) {
          console.error("❌ DB 업데이트 실패:", upsertError);
          throw upsertError;
      }

      console.log("✅ DB 업데이트 성공");

      // 최신 상태를 로컬 data에 반영
      await fetchLatestStatus();
      // 전체 재렌더 대신 근처 마커 색만 빠르게 업데이트
      renderMarkersPartial(coords, newStatus);

      if (currentUser.can_view_others) {
          console.log("👑 관리자 권한 확인: 타 사용자 위치 갱신");
          await loadOtherUserLocations();
      }

      const overlay = getActiveOverlay();
      if (overlay) {
        overlay.setMap(null);
        setActiveOverlay(null);
        activeOverlay = null;
      }
      console.groupEnd();
    } catch (e) {
      console.error("[ERROR][UPDATE] 트랜잭션 실패:", e.message);
      console.groupEnd();
      alert("저장에 실패했습니다. 네트워크를 확인하세요.");
    }
  };

  /** 관리자 모드: 다른 사용자 위치 불러오기 **/
  const loadOtherUserLocations = async () => {
    if (!map) return;
    console.log("[DEBUG][ADMIN] 타 사용자 위치 로드 시작");
    
    otherUserOverlays.current.forEach((ov) => ov.setMap(null));
    otherUserOverlays.current = [];

    const { data: logs, error } = await supabase
      .from("meters")
      .select("address, lat, lng, status, user_id, updated_at")
      .not("user_id", "is", null)
      .order("updated_at", { ascending: false });

    if (error) {
        console.error("[DEBUG][ADMIN] ❌ 불러오기 에러:", error.message);
        return;
    }

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
    console.log(`[DEBUG][ADMIN] 타 사용자 ${otherUserOverlays.current.length}명 표시 완료`);
  };

  /** 내 위치 마커 **/
  useEffect(() => {
    if (!map || !currentUser) return;
    if (navigator.geolocation) {
      console.log("[DEBUG][GPS] 현재 위치 수신 시도...");
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          console.log(`[DEBUG][GPS] 수신 성공: ${lat}, ${lng}`);
          
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
        (err) =>
          console.warn("[DEBUG][GPS] ⚠️ 위치 불러오기 실패 (권한 혹은 기기 문제):", err.message)
      );
    } else {
        console.warn("[DEBUG][GPS] 이 브라우저는 Geolocation을 지원하지 않습니다.");
    }
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
