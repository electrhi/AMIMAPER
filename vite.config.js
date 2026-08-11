import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const replaceRequired = (code, target, replacement, label) => {
  if (!code.includes(target)) {
    throw new Error(`AMIMAPER 변환 실패: ${label} 대상 코드를 찾지 못했습니다.`);
  }
  return code.replace(target, replacement);
};

const insertAfterRequired = (code, target, addition, label) =>
  replaceRequired(code, target, `${target}\n${addition}`, label);

// src/main.jsx의 운영 기능을 빌드/개발 서버 양쪽에 동일하게 반영합니다.
const amimapEnhancementsPlugin = () => ({
  name: "amimap-runtime-enhancements",
  enforce: "pre",
  transform(source, id) {
    if (!id.endsWith("/src/main.jsx") && !id.endsWith("\\src\\main.jsx")) {
      return null;
    }

    let code = source;

    // 1) 관리자 지도: 최근 2시간 이내 작업자 위치만 조회
    const locationTarget = [
      '    .from("user_last_locations")',
      '    .select("user_id,data_file,address,lat,lng,status,updated_at")',
      '    .not("user_id", "is", null)',
      '    .order("updated_at", { ascending: false })',
    ].join("\n");
    const locationReplacement = [
      '    .from("user_last_locations")',
      '    .select("user_id,data_file,address,lat,lng,status,updated_at")',
      '    .not("user_id", "is", null)',
      '    .gte("updated_at", new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString())',
      '    .order("updated_at", { ascending: false })',
    ].join("\n");
    code = replaceRequired(
      code,
      locationTarget,
      locationReplacement,
      "최근 2시간 작업자 위치"
    );

    // 2) 계정별 필터 설정을 로그아웃 후에도 유지하기 위한 로드 완료 ref
    code = insertAfterRequired(
      code,
      '  const [commTypeFilters, setCommTypeFilters] = useState([]);',
      '  const filterPrefsLoadedForUserRef = useRef(null);',
      "필터 저장 ref"
    );

    // 3) 계정별 필터 설정 localStorage 로드/저장
    const roleAnchor = '  const isMeterWorker = currentUserRole === USER_ROLE.METER;';
    const filterPreferenceEffects = [
      "",
      "  // ✅ 계정별 지도 필터 설정 복원 (로그아웃해도 유지)",
      "  useEffect(() => {",
      '    const uid = String(currentUser?.id ?? "").trim();',
      "    filterPrefsLoadedForUserRef.current = null;",
      "    if (!uid) return;",
      "",
      "    // 다른 계정의 필터 상태가 섞이지 않도록 기본값으로 초기화 후 해당 계정 값을 복원",
      '    setMinMarkerCount("");',
      "    setStatusFilters([...STATUS_OPTIONS]);",
      "    setMeterTypeFilters([]);",
      "    setCommTypeFilters([]);",
      "",
      "    const storageKey = `amimap_filter_prefs_${encodeURIComponent(uid)}`;",
      "    try {",
      "      const raw = localStorage.getItem(storageKey);",
      "      if (raw) {",
      "        const saved = JSON.parse(raw);",
      "",
      "        if (Array.isArray(saved?.statusFilters)) {",
      "          setStatusFilters(saved.statusFilters.filter((v) => STATUS_OPTIONS.includes(v)));",
      "        }",
      "        if (Array.isArray(saved?.meterTypeFilters)) {",
      "          setMeterTypeFilters(saved.meterTypeFilters.map((v) => String(v)));",
      "        }",
      "        if (Array.isArray(saved?.commTypeFilters)) {",
      "          setCommTypeFilters(saved.commTypeFilters.map((v) => String(v)));",
      "        }",
      '        if (typeof saved?.minMarkerCount === "string" || typeof saved?.minMarkerCount === "number") {',
      "          setMinMarkerCount(String(saved.minMarkerCount));",
      "        }",
      "      }",
      "    } catch (err) {",
      '      debugWarn("[WARN][FILTER_PREFS] 복원 실패:", err?.message);',
      "    }",
      "",
      "    const readyTimer = setTimeout(() => {",
      "      filterPrefsLoadedForUserRef.current = uid;",
      "    }, 0);",
      "",
      "    return () => clearTimeout(readyTimer);",
      "  }, [currentUser?.id]);",
      "",
      "  // ✅ 현재 계정의 필터 변경사항 저장",
      "  useEffect(() => {",
      '    const uid = String(currentUser?.id ?? "").trim();',
      "    if (!uid || filterPrefsLoadedForUserRef.current !== uid) return;",
      "",
      "    const storageKey = `amimap_filter_prefs_${encodeURIComponent(uid)}`;",
      "    const prefs = {",
      "      minMarkerCount,",
      "      statusFilters,",
      "      meterTypeFilters,",
      "      commTypeFilters,",
      "    };",
      "",
      "    try {",
      "      localStorage.setItem(storageKey, JSON.stringify(prefs));",
      "    } catch (err) {",
      '      debugWarn("[WARN][FILTER_PREFS] 저장 실패:", err?.message);',
      "    }",
      "  }, [",
      "    currentUser?.id,",
      "    minMarkerCount,",
      "    statusFilters,",
      "    meterTypeFilters,",
      "    commTypeFilters,",
      "  ]);",
    ].join("\n");
    code = insertAfterRequired(
      code,
      roleAnchor,
      filterPreferenceEffects,
      "계정별 필터 저장 effect"
    );

    // 4) 주소 라벨에 계기 타입 요약(A/G/E/O) 표시
    code = replaceRequired(
      code,
      'const setAddressLabelContent = (labelEl, row, buildingName = "") => {',
      'const setAddressLabelContent = (labelEl, row, buildingName = "", meterRows = []) => {',
      "주소 라벨 함수 인자"
    );

    const labelAppendAnchor = "  labelEl.appendChild(addrDiv);";
    const typeSummaryBlock = [
      "",
      "  // ✅ 같은 마커에 묶인 계기 타입별 개수 요약",
      "  const typeCounts = { A: 0, G: 0, E: 0, O: 0 };",
      "  const shortCodeByType = {",
      '    "Adv-E": "A",',
      '    "G-Type": "G",',
      '    "E-Type": "E",',
      '    AMIGO: "O",',
      "  };",
      "",
      "  for (const meterRow of meterRows || []) {",
      "    const shortCode = shortCodeByType[getMeterType(meterRow?.meter_id)];",
      "    if (shortCode) typeCounts[shortCode] += 1;",
      "  }",
      "",
      '  const typeSummary = ["A", "G", "E", "O"]',
      "    .filter((code) => typeCounts[code] > 0)",
      "    .map((code) => `${code}[${typeCounts[code]}]`)",
      '    .join(" ");',
      "",
      "  if (typeSummary) {",
      '    const typeDiv = document.createElement("div");',
      "    typeDiv.textContent = typeSummary;",
      '    typeDiv.style.cssText = "margin-top:2px; font-weight:900; text-align:center;";',
      "    labelEl.appendChild(typeDiv);",
      "  }",
    ].join("\n");
    code = insertAfterRequired(
      code,
      labelAppendAnchor,
      typeSummaryBlock,
      "계기 타입 요약 라벨"
    );

    code = replaceRequired(
      code,
      "        setAddressLabelContent(labelEl, list[0], cachedB);",
      "        setAddressLabelContent(labelEl, list[0], cachedB, list);",
      "초기 주소 라벨 계기 목록 전달"
    );
    code = replaceRequired(
      code,
      "                  setAddressLabelContent(lbl.el, list[0], bn);",
      "                  setAddressLabelContent(lbl.el, list[0], bn, list);",
      "건물명 갱신 주소 라벨 계기 목록 전달"
    );

    // 5) 팝업의 인입주 전산화 / 인입주 값을 클릭하면 클립보드 복사
    const inipjuTarget = [
      '              const digitalLine = document.createElement("div");',
      '              digitalLine.textContent = `인입주 전산화 : ${digitalText || "-"}`;',
      "",
      '              const inipjuLine = document.createElement("div");',
      '              inipjuLine.textContent = `인입주 : ${inipjuText || "-"}`;',
    ].join("\n");

    const inipjuReplacement = [
      "              const copyPopupValue = async (value, lineEl, baseText) => {",
      '                const text = String(value ?? "").trim();',
      "                if (!text) return;",
      "",
      "                try {",
      "                  if (navigator.clipboard?.writeText) {",
      "                    await navigator.clipboard.writeText(text);",
      "                  } else {",
      '                    const textarea = document.createElement("textarea");',
      "                    textarea.value = text;",
      '                    textarea.style.position = "fixed";',
      '                    textarea.style.top = "-9999px";',
      "                    document.body.appendChild(textarea);",
      "                    textarea.focus();",
      "                    textarea.select();",
      '                    document.execCommand("copy");',
      "                    document.body.removeChild(textarea);",
      "                  }",
      "",
      "                  lineEl.textContent = `${baseText} ✓ 복사됨`;",
      "                  setTimeout(() => {",
      "                    lineEl.textContent = baseText;",
      "                  }, 800);",
      "                } catch (err) {",
      '                  debugWarn("[WARN][COPY][INIPJU] 실패:", err?.message);',
      '                  alert("복사에 실패했습니다. 다시 시도해주세요.");',
      "                }",
      "              };",
      "",
      '              const digitalLine = document.createElement("div");',
      '              const digitalBaseText = `인입주 전산화 : ${digitalText || "-"}`;',
      "              digitalLine.textContent = digitalBaseText;",
      "              if (digitalText) {",
      '                digitalLine.style.cssText = "cursor:pointer; user-select:none;";',
      '                digitalLine.title = "클릭하면 인입주 전산화 값을 복사합니다.";',
      '                digitalLine.addEventListener("click", (e) => {',
      "                  e.stopPropagation();",
      "                  copyPopupValue(digitalText, digitalLine, digitalBaseText);",
      "                });",
      "              }",
      "",
      '              const inipjuLine = document.createElement("div");',
      '              const inipjuBaseText = `인입주 : ${inipjuText || "-"}`;',
      "              inipjuLine.textContent = inipjuBaseText;",
      "              if (inipjuText) {",
      '                inipjuLine.style.cssText = "cursor:pointer; user-select:none;";',
      '                inipjuLine.title = "클릭하면 인입주 값을 복사합니다.";',
      '                inipjuLine.addEventListener("click", (e) => {',
      "                  e.stopPropagation();",
      "                  copyPopupValue(inipjuText, inipjuLine, inipjuBaseText);",
      "                });",
      "              }",
    ].join("\n");
    code = replaceRequired(
      code,
      inipjuTarget,
      inipjuReplacement,
      "인입주 정보 클립보드 복사"
    );

    return { code, map: null };
  },
});

export default defineConfig({
  plugins: [amimapEnhancementsPlugin(), react()],
  root: ".", // index.html 위치
  build: {
    outDir: "dist",
  },
  preview: {
    port: 10000,                 // Render가 감지할 포트
    host: "0.0.0.0",             // 외부 접근 허용
    allowedHosts: ["amimaper.onrender.com"], // Render 도메인 허용
  },
});
