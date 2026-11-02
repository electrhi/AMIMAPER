// 기존 Vite 변환이 모두 끝난 후 계기 타입별 통신방식 선택만 추가합니다.
const replaceRequired = (code, oldText, newText, label) => {
  if (!code.includes(oldText)) throw new Error("AMIMAPER type/comm filter transform failed: " + label);
  if (code.indexOf(oldText) !== code.lastIndexOf(oldText)) {
    throw new Error("AMIMAPER type/comm filter transform ambiguous: " + label);
  }
  return code.replace(oldText, newText);
};

const replaceRangeRequired = (code, start, end, replacement, label) => {
  const from = code.indexOf(start);
  const to = code.indexOf(end, from + start.length);
  if (from < 0 || to < 0) throw new Error("AMIMAPER type/comm filter range failed: " + label);
  return code.slice(0, from) + replacement + code.slice(to);
};

export const amimapMeterTypeCommFiltersPlugin = () => ({
  name: "amimap-meter-type-comm-filters",
  enforce: "pre",
  transform(source, id) {
    if (!id.endsWith("/src/main.jsx") && !id.endsWith("\\src\\main.jsx")) return null;
    let code = source;

    // [] = 모든 통신방식 (각 계기타입에서 독립적으로 관리)
    code = replaceRequired(
      code,
      '  const [commTypeFilters, setCommTypeFilters] = useState([]);',
      '  const [commTypeFilters, setCommTypeFilters] = useState({});',
      "per-type comm state"
    );

    const filterHelpers = `  // 계기 타입별로 실제 데이터에 존재하는 통신방식만 선택지에 표시합니다.
  const availableCommTypesByMeterType = React.useMemo(() => {
    const byType = {};
    for (const row of data || []) {
      const meterType = getMeterType(row?.meter_id);
      if (!byType[meterType]) byType[meterType] = new Set();
      byType[meterType].add(getCommTypeFilterValue(row));
    }
    return Object.fromEntries(
      Object.entries(byType).map(([meterType, values]) => [
        meterType,
        Array.from(values).sort((a, b) => a.localeCompare(b, "ko-KR", { numeric: true })),
      ])
    );
  }, [data]);

  const getSelectedCommTypes = (meterType) =>
    Array.isArray(commTypeFilters?.[meterType]) ? commTypeFilters[meterType] : [];

  const matchesMeterTypeCommFilter = (row) => {
    const choices = getSelectedCommTypes(getMeterType(row?.meter_id));
    return choices.length === 0 || choices.includes(getCommTypeFilterValue(row));
  };

`;
    code = replaceRequired(
      code,
      '  // ✅ "표시/숨김이 바뀔 수 있는 필터"가 켜져 있나?',
      filterHelpers + '  // ✅ "표시/숨김이 바뀔 수 있는 필터"가 켜져 있나?',
      "per-type comm match helper"
    );

    code = replaceRequired(
      code,
      '  const isCommTypeFilterActive = commTypeFilters.length > 0;',
      '  const isCommTypeFilterActive = Object.values(commTypeFilters).some((choices) => Array.isArray(choices) && choices.length > 0);',
      "comm filter active check"
    );

    // 기존 계정별 localStorage 설정을 보존하고, 과거의 공통 통신방식 배열도 자동 변환합니다.
    code = replaceRequired(
      code,
      '    setCommTypeFilters([]);',
      '    setCommTypeFilters({});',
      "reset per-account comm filters"
    );
    code = replaceRequired(
      code,
      `        if (Array.isArray(saved?.commTypeFilters)) {
          setCommTypeFilters(saved.commTypeFilters.map((v) => String(v)));
        }`,
      `        if (saved?.commTypeFilters && typeof saved.commTypeFilters === "object" && !Array.isArray(saved.commTypeFilters)) {
          const restoredByType = {};
          for (const [meterType, values] of Object.entries(saved.commTypeFilters)) {
            if (Array.isArray(values)) restoredByType[meterType] = values.map((v) => String(v));
          }
          setCommTypeFilters(restoredByType);
        } else if (Array.isArray(saved?.commTypeFilters)) {
          // 과거 공통 필터는 모든 기존 계기 타입에 동일하게 이관하여 종전 표시 결과를 유지합니다.
          const restoredByType = {};
          for (const meterType of new Set([...Object.values(METER_MAPPING), "확인필요"])) {
            restoredByType[meterType] = saved.commTypeFilters.map((v) => String(v));
          }
          setCommTypeFilters(restoredByType);
        }`,
      "restore saved per-type comm filters"
    );

    // 지도 마커와 클러스터가 공통으로 사용하는 행 단위 필터만 변경합니다.
    code = replaceRequired(
      code,
      '        const okComm = !commSet || commSet.has(getCommTypeFilterValue(row));',
      '        const okComm = matchesMeterTypeCommFilter(row);',
      "map/cluster row filter"
    );

    // 상단 상태 건수도 지도와 완전히 같은 필터 기준으로 집계합니다.
    code = replaceRequired(
      code,
      '    if (commSet && !commSet.has(getCommTypeFilterValue(row))) continue;',
      '    if (!matchesMeterTypeCommFilter(row)) continue;',
      "status count filter"
    );
    code = replaceRequired(
      code,
      '      const commSet = commTypeFilters.length ? new Set(commTypeFilters) : null;',
      '      // 통신방식은 계기 타입별 matchesMeterTypeCommFilter()에서 확인',
      "map comm set"
    );
    code = replaceRequired(
      code,
      '  const commSet = commTypeFilters.length ? new Set(commTypeFilters) : null;',
      '  // 통신방식은 계기 타입별 matchesMeterTypeCommFilter()에서 확인',
      "count comm set"
    );

    // 기존 계기 타입 선택 UI / 우선순위 UI는 그대로 두고 통신방식 영역만 대체합니다.
    const commStart = `        <div style={{ marginTop: 14, borderTop: "1px solid rgba(0,0,0,0.08)", paddingTop: 12 }}>
          <div style={{ fontWeight: 900, fontSize: isMobile ? "16px" : "14px", marginBottom: 8 }}>
            통신방식 필터
          </div>`;
    const priorityStart = `          <div style={{ marginTop: 14, borderTop: "1px solid rgba(0,0,0,0.08)", paddingTop: 12 }}>
            <div style={{ fontWeight: 900, fontSize: isMobile ? "16px" : "14px", marginBottom: 8 }}>우선순위 필터</div>`;
    const commUi = `        <div style={{ marginTop: 14, borderTop: "1px solid rgba(0,0,0,0.08)", paddingTop: 12 }}>
          <div style={{ fontWeight: 900, fontSize: isMobile ? "16px" : "14px", marginBottom: 8 }}>
            통신방식 필터 (계기 타입별)
          </div>
          <div style={{ marginBottom: 10, color: "#555", fontSize: isMobile ? "13px" : "12px" }}>
            각 계기 타입에 통신방식을 따로 지정합니다. 타입별 '전체'는 해당 타입의 모든 통신방식을 표시합니다.
          </div>
          {availableMeterTypes.length === 0 ? (
            <div style={{ color: "#64748b", fontSize: isMobile ? "13px" : "12px" }}>
              계기 데이터가 없습니다.
            </div>
          ) : (
            availableMeterTypes.map((meterType) => {
              const options = availableCommTypesByMeterType[meterType] || [];
              const selected = getSelectedCommTypes(meterType);
              const typeEnabled = meterTypeFilters.length === 0 || meterTypeFilters.includes(meterType);

              return (
                <div
                  key={meterType}
                  style={{
                    padding: isMobile ? "10px" : "9px",
                    marginBottom: 10,
                    border: "1px solid rgba(0,0,0,0.10)",
                    borderRadius: 10,
                    background: typeEnabled ? "#fff" : "#f8f9fa",
                  }}
                >
                  <div style={{ fontWeight: 900, marginBottom: 8, fontSize: isMobile ? "14px" : "12px" }}>
                    {meterType} {!typeEnabled && <span style={{ color: "#64748b", fontWeight: 500 }}>(계기 타입 선택 해제됨)</span>}
                  </div>
                  <div style={{ display: "flex", gap: 7, flexWrap: "wrap", alignItems: "center" }}>
                    <button
                      type="button"
                      onClick={() => setCommTypeFilters((prev) => ({ ...prev, [meterType]: [] }))}
                      style={{
                        padding: isMobile ? "9px" : "7px 8px",
                        borderRadius: 9,
                        border: "1px solid #ddd",
                        background: selected.length === 0 ? "#e8f2ff" : "#fff",
                        fontWeight: 900,
                        cursor: "pointer",
                        fontSize: isMobile ? "13px" : "12px",
                      }}
                    >
                      전체
                    </button>
                    {options.length === 0 ? (
                      <span style={{ color: "#64748b", fontSize: isMobile ? "13px" : "12px" }}>
                        통신방식 데이터가 없습니다.
                      </span>
                    ) : (
                      options.map((commType) => {
                        const checked = selected.length === 0 || selected.includes(commType);
                        const toggle = () => {
                          setCommTypeFilters((prev) => {
                            const previous = Array.isArray(prev?.[meterType]) ? prev[meterType] : [];
                            const base = previous.length === 0 ? [...options] : [...previous];
                            const next = base.includes(commType)
                              ? base.filter((value) => value !== commType)
                              : [...base, commType];
                            return { ...prev, [meterType]: next };
                          });
                        };
                        return (
                          <label
                            key={commType}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 5,
                              padding: isMobile ? "9px" : "7px 8px",
                              border: "1px solid rgba(0,0,0,0.08)",
                              borderRadius: 9,
                              background: checked ? "#f1f3f5" : "#fff",
                              cursor: "pointer",
                              userSelect: "none",
                              fontWeight: 800,
                              fontSize: isMobile ? "13px" : "12px",
                            }}
                          >
                            <input type="checkbox" checked={checked} onChange={toggle} style={{ width: 16, height: 16 }} />
                            <span>{commType}</span>
                          </label>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })
          )}
          <div style={{ marginTop: 8, fontSize: isMobile ? "13px" : "12px", color: "#555" }}>
            계기 타입·통신방식·상태·우선순위는 함께 적용됩니다. 서로 다른 계기 타입의 통신방식은 독립적입니다.
          </div>

`;
    code = replaceRangeRequired(code, commStart, priorityStart, commUi, "per-type communication UI");

    // 이전의 공통 필터 확인 및 코드 누락 방지
    if (code.includes('commTypeFilters.length') || code.includes('commSet.has(')) {
      throw new Error("AMIMAPER type/comm filter transform failed: global comm filter remains");
    }

    return { code, map: null };
  },
});
