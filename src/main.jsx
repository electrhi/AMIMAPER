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

  /** 최신 상태 가져오기 (DB 읽기 - 클릭 시 사용) **/
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

    const normalize = (str) =>
      str
        ?.toString()
        .trim()
        .replace(/\s+/g, " ")
        .replace(/\u3000/g, " ")
        .replace(/\r|\n|\t/g, "")
        .replace(/번지/g, "")
        .replace(/ /g, ""); // ✅ 모든 공백 완전 제거

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
        markers.push(overlay);
        markerCount++;

        // 마커 클릭 시 팝업 + 상태 버튼
        const openPopup = async (e) => {
          e.stopPropagation();
          // 여기서 최신 상태 1회 동기화 (클릭 시에만 호출)
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

                    // 하나의 마커에 포함된 모든 계기번호
          const allIds = list.map((g) => String(g.meter_id || ""));

          // ✅ 계기번호 뒤 2자리 기준으로 중복 개수 계산
          const suffixCount = {};
          allIds.forEach((id) => {
            const suffix = id.slice(-2);
            if (!suffix) return;
            suffixCount[suffix] = (suffixCount[suffix] || 0) + 1;
          });

          // 중복 제거한 계기번호 목록
          const uniqueMeters = Array.from(new Set(allIds));

          uniqueMeters.forEach((id) => {
            const div = document.createElement("div");
            const mid = id.substring(2, 4);
            const type = meter_mapping[mid] || "확인필요";
            div.textContent = `${id} | ${type}`;

            // ✅ 뒤 2자리가 같은 계기번호들만 빨간색 처리
            const suffix = id.slice(-2);
            if (suffix && suffixCount[suffix] > 1) {
              div.style.color = "red";
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

  /** 상태 업데이트 (버튼 클릭 시만 DB 업로드) **/
  const updateStatus = async (meterIds, newStatus, coords) => {
    try {
      console.log(
        "[DEBUG][STATUS] 🛠️ 상태 업데이트 시도:",
        meterIds,
        "→",
        newStatus
      );

      const payload = meterIds.map((id) => ({
        meter_id: id,
        address: data.find((d) => d.meter_id === id)?.address || "",
        status: newStatus,
        user_id: currentUser.id,
        lat: parseFloat(coords.lat),
        lng: parseFloat(coords.lng),
        updated_at: new Date().toISOString(),
      }));

      const { error: upsertError } = await supabase.from("meters").upsert(
        payload,
        {
          onConflict: ["meter_id", "address"],
        }
      );
      if (upsertError) throw upsertError;

      console.log("[DEBUG][STATUS] ✅ DB 업데이트 완료:", payload);

      // 최신 상태를 로컬 data에 반영
      await fetchLatestStatus();
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
        (err) =>
          console.warn("[DEBUG][GEO] ⚠️ 위치 불러오기 실패:", err.message)
      );
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
