const replaceRequired = (code, target, replacement, label) => {
  if (!code.includes(target)) {
    throw new Error(`AMIMAPER mixed inipju digital color transform failed: ${label}`);
  }
  return code.replace(target, replacement);
};

const insertAfterRequired = (code, target, addition, label) =>
  replaceRequired(code, target, `${target}\n${addition}`, label);

export const amimapMixedInipjuDigitalColorPlugin = () => ({
  name: "amimap-mixed-inipju-digital-color",
  enforce: "pre",
  transform(source, id) {
    if (!id.endsWith("/src/main.jsx") && !id.endsWith("\\src\\main.jsx")) return null;

    let code = source;

    code = insertAfterRequired(
      code,
      '  const DEFAULT_UNVISITED_ORANGE = "#ff8c00";',
      [
        "",
        "  // ✅ 같은 좌표의 한 마커 안에서 인입주전산화 값이 서로 다르면 강조 표시",
        "  const hasMixedInipjuDigitalValues = (rows) => {",
        "    const values = new Set();",
        "    for (const row of rows || []) {",
        "      const value = String(row?.inipju_digital ?? \"\")",
        "        .trim()",
        "        .replace(/\\s+/g, \" \" );",
        "      values.add(value);",
        "      if (values.size > 1) return true;",
        "    }",
        "    return false;",
        "  };",
      ].join("\n"),
      "mixed inipju helper"
    );

    code = replaceRequired(
      code,
      [
        "        // ✅ 이 좌표 그룹에 농사/농사용이 하나라도 있으면 true",
        "        const hasFarming = list.some((r) => isFarmingContract(r?.contract_type));",
        "        ",
        "        const color = getMarkerColor(진행, hasFarming);",
      ].join("\n"),
      [
        "        // ✅ 이 좌표 그룹에 농사/농사용이 하나라도 있으면 true",
        "        const hasFarming = list.some((r) => isFarmingContract(r?.contract_type));",
        "        // ✅ 동일 좌표 그룹의 인입주전산화가 서로 다르면 파란색 강조",
        "        //    단, 완료/불가는 작업 상태색(초록/빨강)을 최우선으로 표시",
        "        const hasMixedInipjuDigital = hasMixedInipjuDigitalValues(list);",
        "        const normalizedMarkerStatus = normalizeStatusValue(진행);",
        "        const color =",
        "          normalizedMarkerStatus === \"완료\" || normalizedMarkerStatus === \"불가\"",
        "            ? getMarkerColor(normalizedMarkerStatus, hasFarming)",
        "            : hasMixedInipjuDigital",
        "              ? \"blue\"",
        "              : getMarkerColor(normalizedMarkerStatus, hasFarming);",
      ].join("\n"),
      "initial marker color"
    );

    code = replaceRequired(
      code,
      "        overlay.__hasFarming = hasFarming;",
      [
        "        overlay.__hasFarming = hasFarming;",
        "        overlay.__hasMixedInipjuDigital = hasMixedInipjuDigital;",
      ].join("\n"),
      "marker mixed metadata"
    );

    code = replaceRequired(
      code,
      [
        "    const hasFarming = !!overlay.__hasFarming; // ✅ 마커 생성 시 저장한 값 사용",
        "    el.style.background = getMarkerColor(status, hasFarming);",
      ].join("\n"),
      [
        "    const hasFarming = !!overlay.__hasFarming; // ✅ 마커 생성 시 저장한 값 사용",
        "    const hasMixedInipjuDigital = !!overlay.__hasMixedInipjuDigital;",
        "    const normalizedMarkerStatus = normalizeStatusValue(status);",
        "    el.style.background =",
        "      normalizedMarkerStatus === \"완료\" || normalizedMarkerStatus === \"불가\"",
        "        ? getMarkerColor(normalizedMarkerStatus, hasFarming)",
        "        : hasMixedInipjuDigital",
        "          ? \"blue\"",
        "          : getMarkerColor(normalizedMarkerStatus, hasFarming);",
      ].join("\n"),
      "status refresh marker color"
    );

    // 기존 보조 partial updater가 호출되더라도 동일 규칙을 유지합니다.
    code = replaceRequired(
      code,
      [
        "      const hasFarming = !!overlay.__hasFarming;",
        "      const color = getMarkerColor(newStatus, hasFarming);",
      ].join("\n"),
      [
        "      const hasFarming = !!overlay.__hasFarming;",
        "      const hasMixedInipjuDigital = !!overlay.__hasMixedInipjuDigital;",
        "      const normalizedMarkerStatus = normalizeStatusValue(newStatus);",
        "      const color =",
        "        normalizedMarkerStatus === \"완료\" || normalizedMarkerStatus === \"불가\"",
        "          ? getMarkerColor(normalizedMarkerStatus, hasFarming)",
        "          : hasMixedInipjuDigital",
        "            ? \"blue\"",
        "            : getMarkerColor(normalizedMarkerStatus, hasFarming);",
      ].join("\n"),
      "partial marker color"
    );

    // ✅ 왼쪽 상단 상태/검색/필터 패널 접기/펼치기 상태
    code = insertAfterRequired(
      code,
      "const [noCoordModalOpen, setNoCoordModalOpen] = useState(false);",
      "const [isStatusPanelCollapsed, setIsStatusPanelCollapsed] = useState(false);",
      "status panel collapsed state"
    );

    // ✅ 기존 실시간 GPS 위치를 이용한 일반 사용자 '내 위치' 이동 함수
    code = insertAfterRequired(
      code,
      [
        "  const myLastPosRef = useRef(null);",
        "  const myLastHeadingRef = useRef(null);",
      ].join("\n"),
      [
        "",
        "  const moveToMyCurrentLocation = () => {",
        "    if (!map || isAdmin || !window.kakao?.maps) return;",
        "",
        "    const moveTo = (lat, lng) => {",
        "      const latN = Number(lat);",
        "      const lngN = Number(lng);",
        "      if (!Number.isFinite(latN) || !Number.isFinite(lngN)) return;",
        "",
        "      const locPosition = new window.kakao.maps.LatLng(latN, lngN);",
        "      try {",
        "        if (map.getLevel() > 4) map.setLevel(4);",
        "        map.panTo(locPosition);",
        "      } catch (err) {",
        "        debugWarn(\"[WARN][MY_LOCATION] 지도 이동 실패:\", err?.message);",
        "      }",
        "    };",
        "",
        "    const cached = myLastPosRef.current;",
        "    if (cached && Number.isFinite(Number(cached.lat)) && Number.isFinite(Number(cached.lng))) {",
        "      moveTo(cached.lat, cached.lng);",
        "      return;",
        "    }",
        "",
        "    if (!navigator.geolocation) {",
        "      alert(\"현재 위치를 사용할 수 없는 브라우저입니다.\");",
        "      return;",
        "    }",
        "",
        "    navigator.geolocation.getCurrentPosition(",
        "      (pos) => {",
        "        const lat = pos.coords.latitude;",
        "        const lng = pos.coords.longitude;",
        "        myLastPosRef.current = { lat, lng };",
        "        moveTo(lat, lng);",
        "      },",
        "      (err) => {",
        "        debugWarn(\"[WARN][MY_LOCATION] 현재 위치 조회 실패:\", err?.message);",
        "        alert(\"현재 위치를 확인하지 못했습니다. 위치 권한을 확인해주세요.\");",
        "      },",
        "      { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }",
        "    );",
        "  };",
      ].join("\n"),
      "move to my current location"
    );

    const statusPanelOpenTarget = [
      "      {/* 왼쪽 상단 상태 카운트 + 검색/필터 */}",
      "<div",
      "  style={{",
      '    position: "fixed",',
      "    top: 10,",
      "    left: 10,",
      '    background: "white",',
      '    padding: isMobile ? "10px 12px" : "8px 12px",',
      '    borderRadius: "10px",',
      '    boxShadow: "0 2px 8px rgba(0,0,0,0.18)",',
      "    zIndex: 999999,",
      '    fontSize: isMobile ? "13px" : "12px",',
      "    transform: `scale(${isMobile ? 0.665 : 0.546})`,",
      '    transformOrigin: "top left",',
      "  }}",
      ">",
    ].join("\n");

    const statusPanelOpenReplacement = [
      "      {/* 왼쪽 상단 상태 카운트 + 검색/필터 */}",
      "<div",
      "  style={{",
      '    position: "fixed",',
      "    top: 10,",
      "    left: 10,",
      "    zIndex: 999999,",
      '    display: "flex",',
      '    alignItems: "flex-start",',
      "    transform: `scale(${isMobile ? 0.665 : 0.546})`,",
      '    transformOrigin: "top left",',
      "  }}",
      ">",
      "  {!isStatusPanelCollapsed && (",
      "    <div",
      "      style={{",
      '        background: "white",',
      '        padding: isMobile ? "10px 12px" : "8px 12px",',
      '        borderRadius: "10px",',
      '        boxShadow: "0 2px 8px rgba(0,0,0,0.18)",',
      '        fontSize: isMobile ? "13px" : "12px",',
      "      }}",
      "    >",
    ].join("\n");

    code = replaceRequired(
      code,
      statusPanelOpenTarget,
      statusPanelOpenReplacement,
      "collapsible status panel opening"
    );

    const statusPanelCloseTarget = [
      "    >",
      "     ⚙️ 필터",
      "    </button>",
      "  </div>",
      "</div>",
      "",
      "",
      "      {/* ➕ 임의 마커 추가 버튼 + 로그아웃 버튼 (오른쪽 상단) */}",
    ].join("\n");

    const statusPanelCloseReplacement = [
      "    >",
      "     ⚙️ 필터",
      "    </button>",
      "  </div>",
      "    </div>",
      "  )}",
      "  <button",
      "    type=\"button\"",
      "    onClick={() => setIsStatusPanelCollapsed((v) => !v)}",
      "    aria-label={isStatusPanelCollapsed ? \"상태 패널 펼치기\" : \"상태 패널 접기\"}",
      "    title={isStatusPanelCollapsed ? \"상태 패널 펼치기\" : \"상태 패널 접기\"}",
      "    style={{",
      '      width: "32px",',
      '      height: "50px",',
      "      marginLeft: isStatusPanelCollapsed ? 0 : 4,",
      '      padding: 0,',
      '      border: "1px solid rgba(0,0,0,0.12)",',
      '      borderRadius: "8px",',
      '      background: "rgba(255,255,255,0.96)",',
      '      color: "#475569",',
      '      boxShadow: "0 2px 8px rgba(0,0,0,0.14)",',
      '      cursor: "pointer",',
      '      fontSize: "16px",',
      '      fontWeight: 500,',
      '      lineHeight: 1,',
      '      display: "flex",',
      '      alignItems: "center",',
      '      justifyContent: "center",',
      "    }}",
      "  >",
      "    {isStatusPanelCollapsed ? \"▶\" : \"◀\"}",
      "  </button>",
      "</div>",
      "",
      "",
      "      {/* ➕ 임의 마커 추가 버튼 + 로그아웃 버튼 (오른쪽 상단) */}",
    ].join("\n");

    code = replaceRequired(
      code,
      statusPanelCloseTarget,
      statusPanelCloseReplacement,
      "collapsible status panel closing"
    );

    // ✅ 일반 사용자에게만 오른쪽 아래 '내 위치' 버튼 표시
    const myLocationButtonTarget = [
      "      {isAdmin && (",
      "        <button",
      "          onClick={openAdminPage}",
    ].join("\n");

    const myLocationButtonReplacement = [
      "      {!isAdmin && (",
      "        <button",
      "          type=\"button\"",
      "          onClick={moveToMyCurrentLocation}",
      "          aria-label=\"내 위치로 이동\"",
      "          title=\"내 위치로 이동\"",
      "          style={{",
      '            position: "fixed",',
      "            bottom: 20,",
      "            right: 20,",
      "            zIndex: 999999,",
      '            width: "44px",',
      '            height: "44px",',
      '            padding: 0,',
      '            borderRadius: "8px",',
      '            border: "1px solid #d7dce1",',
      '            background: "rgba(255,255,255,0.98)",',
      '            color: "#3f4852",',
      '            cursor: "pointer",',
      '            boxShadow: "0 2px 7px rgba(0,0,0,0.22)",',
      '            display: "flex",',
      '            alignItems: "center",',
      '            justifyContent: "center",',
      "          }}",
      "        >",
      "          <svg width=\"23\" height=\"23\" viewBox=\"0 0 24 24\" fill=\"none\" aria-hidden=\"true\">",
      "            <circle cx=\"12\" cy=\"12\" r=\"6.2\" stroke=\"currentColor\" strokeWidth=\"1.8\" />",
      "            <circle cx=\"12\" cy=\"12\" r=\"2.2\" fill=\"currentColor\" />",
      "            <path d=\"M12 2.5V5M12 19V21.5M2.5 12H5M19 12H21.5\" stroke=\"currentColor\" strokeWidth=\"1.8\" strokeLinecap=\"round\" />",
      "          </svg>",
      "        </button>",
      "      )}",
      "",
      "      {isAdmin && (",
      "        <button",
      "          onClick={openAdminPage}",
    ].join("\n");

    code = replaceRequired(
      code,
      myLocationButtonTarget,
      myLocationButtonReplacement,
      "non-admin current location button"
    );

    return { code, map: null };
  },
});
