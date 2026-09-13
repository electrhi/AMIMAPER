const replaceRequired = (code, target, replacement, label) => {
  if (!code.includes(target)) throw new Error(`AMIMAPER core transform failed: ${label}`);
  return code.replace(target, replacement);
};

const replaceRangeRequired = (code, start, end, replacement, label) => {
  const startIndex = code.indexOf(start);
  if (startIndex < 0) throw new Error(`AMIMAPER core transform failed: ${label} start`);
  const endIndex = code.indexOf(end, startIndex + start.length);
  if (endIndex < 0) throw new Error(`AMIMAPER core transform failed: ${label} end`);
  return code.slice(0, startIndex) + replacement + code.slice(endIndex);
};

export const amimapCorePerformancePlugin = () => ({
  name: "amimap-core-performance",
  enforce: "pre",
  transform(source, id) {
    if (!id.endsWith("/src/main.jsx") && !id.endsWith("\\src\\main.jsx")) return null;
    let code = source;

    code = replaceRequired(
      code,
      '  const meterToKeyRef = useRef(new Map());',
      [
        '  const meterToKeyRef = useRef(new Map());',
        '  const dataByMeterRef = useRef(new Map());',
        '  const markerGroupCacheRef = useRef(new Map());',
        '',
        '  const rebuildMarkerGroupCache = (rows) => {',
        '    const byMeter = new Map();',
        '    for (const row of rows || []) {',
        '      const id = normalizeMeterId(row?.meter_id);',
        '      if (id && !byMeter.has(id)) byMeter.set(id, row);',
        '    }',
        '',
        '    const groups = new Map();',
        '    const uniqueGroupSet = new Set();',
        '    for (const row of byMeter.values()) {',
        '      const address = row?.address;',
        '      const latN = parseFloat(row?.lat);',
        '      const lngN = parseFloat(row?.lng);',
        '      if (!address || !Number.isFinite(latN) || !Number.isFinite(lngN)) continue;',
        '',
        '      const cleanAddr = String(address).trim().replace(/\\s+/g, " ");',
        '      const id = normalizeMeterId(row?.meter_id);',
        '      const uniqueKey = `${cleanAddr}_${id}`;',
        '      if (uniqueGroupSet.has(uniqueKey)) continue;',
        '      uniqueGroupSet.add(uniqueKey);',
        '',
        '      const key = `${latN},${lngN}`;',
        '      if (!groups.has(key)) groups.set(key, { coords: { lat: latN, lng: lngN }, meterIds: [] });',
        '      groups.get(key).meterIds.push(id);',
        '    }',
        '',
        '    dataByMeterRef.current = byMeter;',
        '    markerGroupCacheRef.current = groups;',
        '  };',
      ].join("\n"),
      "marker group cache"
    );

    code = replaceRequired(
      code,
      [
        'const dataRef = useRef([]);',
        'useEffect(() => {',
        '  dataRef.current = data;',
        '}, [data]);',
      ].join("\n"),
      [
        'const dataRef = useRef([]);',
        'useEffect(() => {',
        '  dataRef.current = data;',
        '  const byMeter = new Map();',
        '  for (const row of data || []) {',
        '    const id = normalizeMeterId(row?.meter_id);',
        '    if (id && !byMeter.has(id)) byMeter.set(id, row);',
        '  }',
        '  dataByMeterRef.current = byMeter;',
        '}, [data]);',
      ].join("\n"),
      "meter lookup cache"
    );

    code = replaceRequired(
      code,
      '      setData(merged);',
      '      rebuildMarkerGroupCache(merged);\n      setData(merged);',
      "initial marker group cache"
    );

    code = replaceRequired(
      code,
      '    meterToKeyRef.current.clear();\n    labelByKeyRef.current.clear();',
      '    meterToKeyRef.current.clear();\n    markerGroupCacheRef.current.clear();\n    dataByMeterRef.current.clear();\n    labelByKeyRef.current.clear();',
      "logout cache clear"
    );

    const geoStart = '  /** ✅ geoCache 매칭 (엑셀 address ↔ JSON 좌표) **/';
    const geoEnd = '\n\n\n  /** 마커 렌더링 **/';
    const geoReplacement = [
      '  /** ✅ geoCache 매칭 — 파일/캐시 로드 시 1회 **/',
      '  useEffect(() => {',
      '    if (!geoCache || Object.keys(geoCache).length === 0) return;',
      '    const sourceData = dataRef.current;',
      '    if (!sourceData || sourceData.length === 0) return;',
      '',
      '    const normalizeAddr = (str) =>',
      '      str',
      '        ?.toString()',
      '        .trim()',
      '        .replace(/\\s+/g, " ")',
      '        .replace(/\\u3000/g, " ")',
      '        .replace(/\\r|\\n|\\t/g, "")',
      '        .replace(/번지/g, "")',
      '        .replace(/ /g, "");',
      '',
      '    const entries = Object.entries(geoCache).map(([key, value]) => [normalizeAddr(key), value]);',
      '    const exactMap = new Map();',
      '    for (const [key, value] of entries) {',
      '      if (key && !exactMap.has(key)) exactMap.set(key, value);',
      '    }',
      '',
      '    const matchedData = sourceData.map((row) => {',
      '      const addr = normalizeAddr(row?.address);',
      '      if (!addr) return row;',
      '      let value = exactMap.get(addr) || null;',
      '      if (!value) {',
      '        const partial = entries.find(([key]) => key && (key.includes(addr) || addr.includes(key)));',
      '        if (partial) value = partial[1];',
      '      }',
      '      if (!value) {',
      '        const parts = addr.split(" ");',
      '        const dongName = parts[2] || parts[1] || parts[0];',
      '        const similar = entries.find(([key]) => key && key.includes(dongName) && key.slice(-5) === addr.slice(-5));',
      '        if (similar) value = similar[1];',
      '      }',
      '      if (!value) return row;',
      '      return {',
      '        ...row,',
      '        lat: parseFloat(value.lat),',
      '        lng: parseFloat(value.lng),',
      '        road_address: value.road_address || row.road_address || "",',
      '        building_name: value.building_name || row.building_name || "",',
      '      };',
      '    });',
      '',
      '    const changed = matchedData.some((row, index) => {',
      '      const prev = sourceData[index] || {};',
      '      return (',
      '        String(prev?.lat ?? "") !== String(row?.lat ?? "") ||',
      '        String(prev?.lng ?? "") !== String(row?.lng ?? "") ||',
      '        String(prev?.road_address ?? "") !== String(row?.road_address ?? "") ||',
      '        String(prev?.building_name ?? "") !== String(row?.building_name ?? "")',
      '      );',
      '    });',
      '',
      '    rebuildMarkerGroupCache(matchedData);',
      '    if (!changed) return;',
      '    setData(matchedData);',
      '    setLayoutVersion((value) => value + 1);',
      '  }, [geoCache, currentUser?.data_file]);',
    ].join("\n");
    code = replaceRangeRequired(code, geoStart, geoEnd, geoReplacement, "geo cache once");

    const colorStart = '  // ✅ (추가) meterIds가 속한 마커들만 찾아서 색만 업데이트';
    const colorEnd = '\n\n\n  const renderMarkersPartial =';
    const colorReplacement = [
      '  // ✅ meterIds가 속한 마커들만 찾아서 색만 업데이트',
      '  const updateMarkerColorsByMeterIds = (meterIds, latestMap = null) => {',
      '    if (!meterIds || meterIds.length === 0) return;',
      '    if (isStatusFilterActive || isMeterTypeFilterActive || isCommTypeFilterActive) {',
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
      '      const primaryId = normalizeMeterId(overlay.__meterIds?.[0]);',
      '      if (!primaryId) continue;',
      '      const row = latestMap?.get(primaryId) || dataByMeterRef.current.get(primaryId) || metersCacheRef.current.get(primaryId);',
      '      if (row?.status) setOverlayColor(overlay, row.status);',
      '    }',
      '  };',
    ].join("\n");
    code = replaceRangeRequired(code, colorStart, colorEnd, colorReplacement, "partial marker color");

    const groupStart = '      const grouped = {};';
    const groupEnd = '      let markerCount = 0;';
    const groupReplacement = [
      '      const allRowsForMap = Array.from(dataByMeterRef.current.values());',
      '      if (markerGroupCacheRef.current.size === 0 && allRowsForMap.length > 0) {',
      '        rebuildMarkerGroupCache(allRowsForMap);',
      '      }',
      '      const grouped = markerGroupCacheRef.current;',
      '      const statusSet = statusFilters.length ? new Set(statusFilters) : null;',
      '      const typeSet = meterTypeFilters.length ? new Set(meterTypeFilters) : null;',
      '      const commSet = commTypeFilters.length ? new Set(commTypeFilters) : null;',
      '',
      '      const rowPassesMapFilters = (row) => {',
      '        const visibleStatus = getVisibleStatusByRole(row?.status, currentUserRole);',
      '        const okStatus = !statusSet || statusSet.has(visibleStatus);',
      '        const okType = !typeSet || typeSet.has(getMeterType(row?.meter_id));',
      '        const okComm = !commSet || commSet.has(getCommTypeFilterValue(row));',
      '        return okStatus && okType && okComm;',
      '      };',
      '',
      '      let matchedRowCount = 0;',
      '      for (const row of allRowsForMap) if (rowPassesMapFilters(row)) matchedRowCount += 1;',
      '      debugLog(`[DEBUG][MAP] ✅ 필터 조건 매칭 ${matchedRowCount}건 / 좌표 그룹 ${grouped.size}개`);',
      '',
    ].join("\n");
    code = replaceRangeRequired(code, groupStart, groupEnd, groupReplacement, "cached marker groups");

    code = replaceRequired(
      code,
      '      Object.keys(grouped).forEach((key) => {\n        const { coords, list, hasFilterMatch } = grouped[key];',
      [
        '      grouped.forEach((group, key) => {',
        '        const { coords, meterIds } = group;',
        '        const list = meterIds.map((id) => dataByMeterRef.current.get(id)).filter(Boolean);',
        '        const hasFilterMatch = list.some(rowPassesMapFilters);',
      ].join("\n"),
      "cached group iteration"
    );

    code = replaceRequired(
      code,
      '          e.stopPropagation();\n          // ✅ 어떤 마커를 클릭하든 "현재 화면 내 전체"를 최신화\n          await fetchLatestStatus();',
      [
        '          e.stopPropagation();',
        '          const popupMeterIds = list.map((row) => normalizeMeterId(row?.meter_id)).filter(Boolean);',
        '          fetchLatestStatus(popupMeterIds).catch((error) =>',
        '            debugWarn("[WARN][POPUP] 백그라운드 최신화 실패:", error?.message)',
        '          );',
      ].join("\n"),
      "instant popup targeted sync"
    );

    code = replaceRequired(
      code,
      '    try { fetchLatestStatus(); } catch {}',
      '    try { fetchLatestStatus(getVisibleMeterIds()); } catch {}',
      "search visible sync"
    );

    code = replaceRequired(
      code,
      'await fetchLatestStatus(payload.map((p) => p.meter_id));',
      [
        'fetchLatestStatus(payload.map((p) => p.meter_id)).catch((error) =>',
        '  debugWarn("[WARN][STATUS] 저장 후 검증 실패:", error?.message)',
        ');',
      ].join("\n"),
      "nonblocking post status validation"
    );

    return { code, map: null };
  },
});
