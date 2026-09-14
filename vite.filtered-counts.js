const replaceRangeRequired = (code, start, end, replacement, label) => {
  const startIndex = code.indexOf(start);
  if (startIndex < 0) throw new Error(`AMIMAPER filtered counts transform failed: ${label} start`);
  const endIndex = code.indexOf(end, startIndex + start.length);
  if (endIndex < 0) throw new Error(`AMIMAPER filtered counts transform failed: ${label} end`);
  return code.slice(0, startIndex) + replacement + code.slice(endIndex + end.length);
};

export const amimapFilteredCountsPlugin = () => ({
  name: "amimap-filtered-counts",
  enforce: "pre",
  transform(source, id) {
    if (!id.endsWith("/src/main.jsx") && !id.endsWith("\\src\\main.jsx")) return null;
    let code = source;

    const start = "// ✅ status 변경으로 data가 바뀌어도 카운트는 항상 최신 유지 ✅✅✅";
    const end = "}, [data, currentUserRole]);";

    const replacement = [
      "// ✅ 상단 완료/불가/미방문 카운트 = 현재 지도 필터를 통과한 실제 계기 수",
      "//    - 계기번호 중복은 1회만 집계",
      "//    - 좌표가 없어 지도/클러스터에 표현할 수 없는 계기는 미좌표에서 별도 집계",
      "//    - 상태/계기타입/통신방식/우선순위/마커개수 필터를 모두 동일하게 적용",
      "useEffect(() => {",
      "  const next = { 완료: 0, 불가: 0, 미방문: 0 };",
      "  const byMeter = new Map();",
      "",
      "  for (const row of data || []) {",
      "    const id = normalizeMeterId(row?.meter_id);",
      "    if (id && !byMeter.has(id)) byMeter.set(id, row);",
      "  }",
      "",
      "  const groupSizes = new Map();",
      "  for (const row of byMeter.values()) {",
      "    const address = String(row?.address ?? \"\").trim();",
      "    const lat = parseFloat(row?.lat);",
      "    const lng = parseFloat(row?.lng);",
      "    if (!address || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;",
      "    const key = `${lat},${lng}`;",
      "    groupSizes.set(key, (groupSizes.get(key) || 0) + 1);",
      "  }",
      "",
      "  const statusSet = statusFilters.length ? new Set(statusFilters) : null;",
      "  const typeSet = meterTypeFilters.length ? new Set(meterTypeFilters) : null;",
      "  const commSet = commTypeFilters.length ? new Set(commTypeFilters) : null;",
      "  const prioritySet = priorityFilters.length ? new Set(priorityFilters.map(normalizePriorityValue)) : null;",
      "  const threshold = parseInt(minMarkerCount, 10);",
      "  const useSizeFilter = Number.isFinite(threshold) && threshold > 0;",
      "",
      "  for (const row of byMeter.values()) {",
      "    const address = String(row?.address ?? \"\").trim();",
      "    const lat = parseFloat(row?.lat);",
      "    const lng = parseFloat(row?.lng);",
      "    if (!address || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;",
      "",
      "    const key = `${lat},${lng}`;",
      "    if (useSizeFilter && (groupSizes.get(key) || 0) < threshold) continue;",
      "",
      "    const visibleStatus = getVisibleStatusByRole(row?.status, currentUserRole);",
      "    if (statusSet && !statusSet.has(visibleStatus)) continue;",
      "    if (typeSet && !typeSet.has(getMeterType(row?.meter_id))) continue;",
      "    if (commSet && !commSet.has(getCommTypeFilterValue(row))) continue;",
      "    if (prioritySet && !prioritySet.has(normalizePriorityValue(row?.priority))) continue;",
      "",
      "    next[visibleStatus] = (next[visibleStatus] || 0) + 1;",
      "  }",
      "",
      "  setCounts((prev) => {",
      "    const same =",
      "      prev.완료 === next.완료 &&",
      "      prev.불가 === next.불가 &&",
      "      prev.미방문 === next.미방문;",
      "    return same ? prev : next;",
      "  });",
      "}, [data, currentUserRole, statusFilters, meterTypeFilters, commTypeFilters, priorityFilters, minMarkerCount]);",
    ].join("\n");

    code = replaceRangeRequired(code, start, end, replacement, "filtered status counts");
    return { code, map: null };
  },
});
