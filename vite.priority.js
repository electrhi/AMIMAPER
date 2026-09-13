const replaceRequired = (code, target, replacement, label) => {
  if (!code.includes(target)) throw new Error(`AMIMAPER priority transform failed: ${label}`);
  return code.replace(target, replacement);
};

const insertAfterRequired = (code, target, addition, label) =>
  replaceRequired(code, target, `${target}\n${addition}`, label);

export const amimapPriorityPlugin = () => ({
  name: "amimap-priority",
  enforce: "pre",
  transform(source, id) {
    if (!id.endsWith("/src/main.jsx") && !id.endsWith("\\src\\main.jsx")) return null;
    let code = source;

    // 우선순위의 원본은 Excel의 "우선순위" 열입니다.
    code = insertAfterRequired(
      code,
      'const STATUS_OPTIONS = ["완료", "불가", "미방문"];',
      [
        'const PRIORITY_OPTIONS = [1, 2, 3];',
        'const normalizePriorityValue = (value) => {',
        '  const n = Number(String(value ?? "").trim());',
        '  return n === 1 || n === 2 || n === 3 ? n : 1;',
        '};',
        'const getPriorityText = (priority) => `${normalizePriorityValue(priority)}순위`;',
        'const getPriorityColor = (priority) => {',
        '  const p = normalizePriorityValue(priority);',
        '  return p === 1 ? "#ef4444" : p === 2 ? "#f97316" : "#22c55e";',
        '};',
      ].join("\n"),
      "priority constants"
    );

    // 기존 필터들과 동일하게 계정별 설정 저장/복원 대상에 포함합니다.
    code = insertAfterRequired(
      code,
      '  const [commTypeFilters, setCommTypeFilters] = useState([]);',
      '  const [priorityFilters, setPriorityFilters] = useState([]);',
      "priority filter state"
    );

    code = replaceRequired(
      code,
      '    setMeterTypeFilters([]);\n    setCommTypeFilters([]);',
      '    setMeterTypeFilters([]);\n    setCommTypeFilters([]);\n    setPriorityFilters([]);',
      "priority filter reset"
    );

    code = replaceRequired(
      code,
      '        if (Array.isArray(saved?.commTypeFilters)) {\n          setCommTypeFilters(saved.commTypeFilters.map((v) => String(v)));\n        }',
      [
        '        if (Array.isArray(saved?.commTypeFilters)) {',
        '          setCommTypeFilters(saved.commTypeFilters.map((v) => String(v)));',
        '        }',
        '        if (Array.isArray(saved?.priorityFilters)) {',
        '          setPriorityFilters(saved.priorityFilters.map(Number).filter((v) => PRIORITY_OPTIONS.includes(v)));',
        '        }',
      ].join("\n"),
      "priority filter restore"
    );

    code = replaceRequired(
      code,
      '      commTypeFilters,\n    };',
      '      commTypeFilters,\n      priorityFilters,\n    };',
      "priority filter save"
    );

    code = replaceRequired(
      code,
      '    commTypeFilters,\n  ]);',
      '    commTypeFilters,\n    priorityFilters,\n  ]);',
      "priority filter save deps"
    );

    code = replaceRequired(
      code,
      '  }, [statusFilters, meterTypeFilters, commTypeFilters, showAddressLabels, addressLabelMode]);',
      '  }, [statusFilters, meterTypeFilters, commTypeFilters, priorityFilters, showAddressLabels, addressLabelMode]);',
      "priority render deps"
    );

    // Excel 행에서 우선순위를 직접 읽습니다. DB meters.priority 값은 사용하지 않습니다.
    code = replaceRequired(
      code,
      '        contract_type: r["계약종별"] || "",\n        lat:',
      '        contract_type: r["계약종별"] || "",\n        priority: normalizePriorityValue(r["우선순위"] ?? r["priority"]),\n        lat:',
      "Excel priority column"
    );

    const colorEnd = [
      '    if (hasFarming) return FARMING_YELLOW;',
      '    return DEFAULT_UNVISITED_ORANGE;',
      '  };',
    ].join("\n");

    const helpers = [
      '',
      '  const getHighestPriority = (rows) => {',
      '    let best = 3;',
      '    for (const row of rows || []) best = Math.min(best, normalizePriorityValue(row?.priority));',
      '    return best;',
      '  };',
    ].join("\n");
    code = insertAfterRequired(code, colorEnd, helpers, "priority helper");

    // 기존 상태/계기타입/통신방식과 AND로 적용합니다.
    code = replaceRequired(
      code,
      '      const commSet = commTypeFilters.length ? new Set(commTypeFilters) : null;',
      '      const commSet = commTypeFilters.length ? new Set(commTypeFilters) : null;\n      const prioritySet = priorityFilters.length ? new Set(priorityFilters.map(normalizePriorityValue)) : null;',
      "priority filter set"
    );

    code = replaceRequired(
      code,
      '        const okComm = !commSet || commSet.has(getCommTypeFilterValue(row));\n        return okStatus && okType && okComm;',
      '        const okComm = !commSet || commSet.has(getCommTypeFilterValue(row));\n        const okPriority = !prioritySet || prioritySet.has(normalizePriorityValue(row?.priority));\n        return okStatus && okType && okComm && okPriority;',
      "priority filter and"
    );

    // 주소 라벨 맨 앞에 색 원만 표시합니다.
    // 같은 좌표에 여러 계기가 있으면 그중 가장 높은 우선순위(1 > 2 > 3)를 사용합니다.
    const addressLabelTarget = [
      '  const addrDiv = document.createElement("div");',
      '  addrDiv.textContent =',
      '    bname && bname !== "__NONE__"',
      '      ? `${addressText} (${bname})`',
      '      : addressText;',
      '  addrDiv.style.cssText = "font-weight:800;";',
      '  labelEl.appendChild(addrDiv);',
    ].join("\n");

    const addressLabelReplacement = [
      '  const addrDiv = document.createElement("div");',
      '  addrDiv.style.cssText = "font-weight:800;display:flex;align-items:center;gap:5px;";',
      '',
      '  const priority = getHighestPriority(meterRows?.length ? meterRows : [row]);',
      '  const priorityDot = document.createElement("span");',
      '  priorityDot.setAttribute("aria-label", getPriorityText(priority));',
      '  priorityDot.title = getPriorityText(priority);',
      '  priorityDot.style.cssText = `display:inline-block;flex:0 0 auto;width:9px;height:9px;border-radius:50%;background:${getPriorityColor(priority)};box-shadow:0 0 0 1px rgba(0,0,0,0.18);`;',
      '',
      '  const addressSpan = document.createElement("span");',
      '  addressSpan.textContent =',
      '    bname && bname !== "__NONE__"',
      '      ? `${addressText} (${bname})`',
      '      : addressText;',
      '',
      '  addrDiv.appendChild(priorityDot);',
      '  addrDiv.appendChild(addressSpan);',
      '  labelEl.appendChild(addrDiv);',
    ].join("\n");

    code = replaceRequired(
      code,
      addressLabelTarget,
      addressLabelReplacement,
      "priority address dot"
    );

    // 필터 패널에 우선순위 다중 필터를 추가합니다.
    const filterAnchor = [
      '          <div style={{ marginTop: 8, fontSize: isMobile ? "13px" : "12px", color: "#555" }}>',
      '            계기 타입 필터와 동시에 적용됩니다. 아무것도 선택 안 하면 전체 표시',
      '          </div>',
    ].join("\n");

    const filterUi = [
      filterAnchor,
      '',
      '          <div style={{ marginTop: 14, borderTop: "1px solid rgba(0,0,0,0.08)", paddingTop: 12 }}>',
      '            <div style={{ fontWeight: 900, fontSize: isMobile ? "16px" : "14px", marginBottom: 8 }}>우선순위 필터</div>',
      '            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>',
      '              <button onClick={() => setPriorityFilters([])} style={{ padding: isMobile ? "10px 10px" : "7px 8px", borderRadius: "10px", border: "1px solid #ddd", background: priorityFilters.length === 0 ? "#f1f3f5" : "#fff", fontWeight: 900, cursor: "pointer", fontSize: isMobile ? "13px" : "12px" }}>전체</button>',
      '              {PRIORITY_OPTIONS.map((priority) => {',
      '                const checked = priorityFilters.length === 0 || priorityFilters.includes(priority);',
      '                const toggle = () => setPriorityFilters((prev) => {',
      '                  const base = prev.length === 0 ? [...PRIORITY_OPTIONS] : [...prev];',
      '                  return base.includes(priority) ? base.filter((value) => value !== priority) : [...base, priority];',
      '                });',
      '                return (',
      '                  <label key={priority} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", userSelect: "none", padding: isMobile ? "10px 10px" : "7px 8px", borderRadius: "10px", border: "1px solid rgba(0,0,0,0.08)", background: checked ? "#f1f3f5" : "#fff", fontWeight: 900 }}>',
      '                    <input type="checkbox" checked={checked} onChange={toggle} style={{ width: 16, height: 16 }} />',
      '                    <span aria-hidden="true" style={{ display: "inline-block", width: 9, height: 9, borderRadius: "50%", background: getPriorityColor(priority), boxShadow: "0 0 0 1px rgba(0,0,0,0.15)" }} />',
      '                    <span style={{ fontSize: isMobile ? "14px" : "12px" }}>{getPriorityText(priority)}</span>',
      '                  </label>',
      '                );',
      '              })}',
      '            </div>',
      '            <div style={{ marginTop: 8, fontSize: isMobile ? "13px" : "12px", color: "#555" }}>상태·계기타입·통신방식 필터와 동시에 적용됩니다. 아무것도 선택 안 하면 전체 표시</div>',
      '          </div>',
    ].join("\n");

    code = replaceRequired(code, filterAnchor, filterUi, "priority filter ui");

    return { code, map: null };
  },
});
