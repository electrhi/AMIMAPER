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

    code = insertAfterRequired(
      code,
      'const STATUS_OPTIONS = ["완료", "불가", "미방문"];',
      [
        'const PRIORITY_OPTIONS = [1, 2, 3];',
        'const normalizePriorityValue = (value) => {',
        '  const n = Number(value);',
        '  return n === 1 || n === 2 || n === 3 ? n : 3;',
        '};',
        'const getPriorityText = (priority) => {',
        '  const p = normalizePriorityValue(priority);',
        '  return p === 1 ? "P1 긴급" : p === 2 ? "P2 우선" : "P3 일반";',
        '};',
      ].join("\n"),
      "priority constants"
    );

    code = insertAfterRequired(
      code,
      '  const [commTypeFilters, setCommTypeFilters] = useState([]);',
      '  const [priorityFilters, setPriorityFilters] = useState([]);',
      "priority filter state"
    );

    code = insertAfterRequired(
      code,
      '  const isCommTypeFilterActive = commTypeFilters.length > 0;',
      '  const isPriorityFilterActive = priorityFilters.length > 0;',
      "priority filter active"
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

    const oldColumns = 'const columns = "meter_id,status,updated_at";';
    if (!code.includes(oldColumns)) throw new Error("AMIMAPER priority transform failed: meter columns");
    code = code.split(oldColumns).join('const columns = "meter_id,status,priority,updated_at";');

    code = replaceRequired(
      code,
      '          status: m?.status || "미방문",',
      '          status: m?.status || "미방문",\n          priority: normalizePriorityValue(m?.priority),',
      "initial priority merge"
    );

    code = replaceRequired(
      code,
      '      return m ? { ...row, status: m.status || row.status } : row;',
      [
        '      return m',
        '        ? {',
        '            ...row,',
        '            status: m.status || row.status,',
        '            priority: normalizePriorityValue(m.priority ?? row.priority),',
        '          }',
        '        : row;',
      ].join("\n"),
      "partial priority merge"
    );

    code = replaceRequired(
      code,
      '      rebuildMarkerGroupCache(merged);\n      setData(merged);',
      [
        '      rebuildMarkerGroupCache(merged);',
        '      setData(merged);',
        '      for (const row of Object.values(latestMap)) {',
        '        const id = normalizeMeterId(row?.meter_id);',
        '        if (id) metersCacheRef.current.set(id, row);',
        '      }',
      ].join("\n"),
      "initial meter cache"
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
      '',
      '  const priorityZIndex = (priority) => {',
      '    const p = normalizePriorityValue(priority);',
      '    return p === 1 ? 30 : p === 2 ? 20 : 10;',
      '  };',
      '',
      '  const applyPriorityStyleToOverlay = (overlay, priority) => {',
      '    const el = overlay?.getContent?.();',
      '    if (!(el instanceof HTMLElement)) return;',
      '    const p = normalizePriorityValue(priority);',
      '    const size = p === 1 ? 29 : p === 2 ? 25 : 21;',
      '    el.style.position = "relative";',
      '    el.style.width = `${size}px`;',
      '    el.style.height = `${size}px`;',
      '    el.style.lineHeight = `${size}px`;',
      '    el.style.outline = p === 1 ? "3px solid rgba(17,24,39,0.9)" : p === 2 ? "2px solid rgba(55,65,81,0.85)" : "none";',
      '    el.style.outlineOffset = p === 1 ? "2px" : p === 2 ? "1px" : "0";',
      '    el.querySelector(".amimap-priority-badge")?.remove();',
      '    if (p < 3) {',
      '      const badge = document.createElement("span");',
      '      badge.className = "amimap-priority-badge";',
      '      badge.textContent = `P${p}`;',
      '      badge.style.cssText = "position:absolute;top:-10px;right:-12px;min-width:18px;height:16px;padding:0 3px;box-sizing:border-box;border-radius:8px;background:#111827;color:white;border:1px solid white;font-size:9px;font-weight:900;line-height:14px;text-align:center;pointer-events:none;box-shadow:0 1px 3px rgba(0,0,0,0.35);";',
      '      el.appendChild(badge);',
      '    }',
      '    overlay.__priority = p;',
      '    try { overlay.setZIndex?.(priorityZIndex(p)); } catch {}',
      '  };',
      '',
      '  const updateMarkerPrioritiesByMeterIds = (meterIds, latestMap = null) => {',
      '    if (!meterIds || meterIds.length === 0) return;',
      '    if (isPriorityFilterActive) {',
      '      requestFullRender.current();',
      '      return;',
      '    }',
      '    const keys = new Set();',
      '    for (const id of meterIds) {',
      '      const key = meterToKeyRef.current.get(normalizeMeterId(id));',
      '      if (key) keys.add(key);',
      '    }',
      '    for (const key of keys) {',
      '      const overlay = overlayByKeyRef.current.get(key);',
      '      if (!overlay) continue;',
      '      let priority = 3;',
      '      for (const id of overlay.__meterIds || []) {',
      '        const norm = normalizeMeterId(id);',
      '        const row = latestMap?.get(norm) || dataByMeterRef.current.get(norm) || metersCacheRef.current.get(norm);',
      '        priority = Math.min(priority, normalizePriorityValue(row?.priority));',
      '      }',
      '      applyPriorityStyleToOverlay(overlay, priority);',
      '    }',
      '  };',
    ].join("\n");
    code = insertAfterRequired(code, colorEnd, helpers, "priority marker helpers");

    code = replaceRequired(
      code,
      '    if (isStatusFilterActive || isMeterTypeFilterActive || isCommTypeFilterActive) {',
      '    if (isStatusFilterActive || isMeterTypeFilterActive || isCommTypeFilterActive || isPriorityFilterActive) {',
      "priority filter partial render"
    );

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

    code = insertAfterRequired(
      code,
      '        const 진행 = list[0].status;',
      '        const markerPriority = getHighestPriority(list);',
      "group priority"
    );

    code = replaceRequired(
      code,
      '          yAnchor: 1,\n        });',
      '          yAnchor: 1,\n          zIndex: priorityZIndex(markerPriority),\n        });\n        applyPriorityStyleToOverlay(overlay, markerPriority);',
      "priority marker style"
    );

    code = replaceRequired(
      code,
      '  updateMarkerColorsByMeterIds(ids, latest);',
      '  updateMarkerColorsByMeterIds(ids, latest);\n  updateMarkerPrioritiesByMeterIds(ids, latest);',
      "priority partial update"
    );

    const updatePriority = [
      '',
      '  const updatePriority = async (meterIds, newPriority, coords) => {',
      '    const dataFile = currentUser?.data_file;',
      '    if (!dataFile) return;',
      '    const priority = normalizePriorityValue(newPriority);',
      '    const ids = Array.from(new Set((meterIds || []).map(normalizeMeterId))).filter(Boolean);',
      '    if (ids.length === 0) return;',
      '',
      '    const payload = ids.map((id) => {',
      '      const row = dataByMeterRef.current.get(id) || {};',
      '      return {',
      '        data_file: dataFile,',
      '        meter_id: id,',
      '        address: row.address || "",',
      '        status: normalizeStatusValue(row.status),',
      '        priority,',
      '        user_id: currentUser?.id || null,',
      '        lat: Number.isFinite(Number(coords?.lat)) ? Number(coords.lat) : null,',
      '        lng: Number.isFinite(Number(coords?.lng)) ? Number(coords.lng) : null,',
      '        updated_at: new Date().toISOString(),',
      '      };',
      '    });',
      '',
      '    const { error } = await supabase',
      '      .from("meters")',
      '      .upsert(payload, { onConflict: "data_file,meter_id,address" })',
      '      .select("meter_id,priority,updated_at");',
      '    if (error) throw error;',
      '',
      '    const idSet = new Set(ids);',
      '    setData((prev) => prev.map((row) => idSet.has(normalizeMeterId(row?.meter_id)) ? { ...row, priority } : row));',
      '    const latest = new Map();',
      '    for (const row of payload) {',
      '      const id = normalizeMeterId(row.meter_id);',
      '      const current = dataByMeterRef.current.get(id) || {};',
      '      const merged = { ...current, ...row, priority };',
      '      dataByMeterRef.current.set(id, merged);',
      '      metersCacheRef.current.set(id, merged);',
      '      latest.set(id, merged);',
      '    }',
      '    updateMarkerPrioritiesByMeterIds(ids, latest);',
      '    if (isPriorityFilterActive) requestFullRender.current();',
      '  };',
    ].join("\n");
    code = insertAfterRequired(
      code,
      '  /** 상태 업데이트 (버튼 클릭 시만 DB 업로드, 상태 흐름: 미방문 > 교체 > 완료 | 불가) **/',
      updatePriority,
      "priority update function"
    );

    const popup = [
      '          const priorityBox = document.createElement("div");',
      '          priorityBox.style.cssText = "display:flex;gap:4px;flex-wrap:wrap;margin:6px 0 4px;";',
      '          const priorityButtons = [];',
      '          const refreshPriorityButtons = (selected) => {',
      '            priorityButtons.forEach(({ button, priority }) => {',
      '              const active = priority === selected;',
      '              button.style.background = active ? "#111827" : "#fff";',
      '              button.style.color = active ? "#fff" : "#111827";',
      '              button.style.borderColor = active ? "#111827" : "#d1d5db";',
      '            });',
      '          };',
      '          PRIORITY_OPTIONS.forEach((priority) => {',
      '            const button = document.createElement("button");',
      '            button.type = "button";',
      '            button.textContent = getPriorityText(priority);',
      '            button.style.cssText = "padding:4px 6px;border:1px solid #d1d5db;border-radius:7px;font-size:10px;font-weight:800;cursor:pointer;";',
      '            button.addEventListener("click", async (event) => {',
      '              event.stopPropagation();',
      '              button.disabled = true;',
      '              try {',
      '                await updatePriority(list.map((row) => row.meter_id), priority, coords);',
      '                list.forEach((row) => { row.priority = priority; });',
      '                refreshPriorityButtons(priority);',
      '              } catch (error) {',
      '                debugError("[ERROR][PRIORITY] 저장 실패:", error?.message);',
      '              } finally {',
      '                button.disabled = false;',
      '              }',
      '            });',
      '            priorityButtons.push({ button, priority });',
      '            priorityBox.appendChild(button);',
      '          });',
      '          refreshPriorityButtons(getHighestPriority(list));',
      '          popupEl.appendChild(priorityBox);',
      '',
    ].join("\n");
    code = replaceRequired(
      code,
      '          popupEl.appendChild(document.createElement("hr"));',
      `${popup}          popupEl.appendChild(document.createElement("hr"));`,
      "priority popup"
    );

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
      '                    <span style={{ fontSize: isMobile ? "14px" : "12px" }}>{getPriorityText(priority)}</span>',
      '                  </label>',
      '                );',
      '              })}',
      '            </div>',
      '            <div style={{ marginTop: 8, fontSize: isMobile ? "13px" : "12px", color: "#555" }}>상태·계기타입·통신방식 필터와 동시에 적용됩니다.</div>',
      '          </div>',
    ].join("\n");
    code = replaceRequired(code, filterAnchor, filterUi, "priority filter ui");

    return { code, map: null };
  },
});
