const replaceRangeRequired = (code, start, end, replacement, label) => {
  const startIndex = code.indexOf(start);
  if (startIndex < 0) throw new Error(`AMIMAPER cluster meter count transform failed: ${label} start`);
  const endIndex = code.indexOf(end, startIndex + start.length);
  if (endIndex < 0) throw new Error(`AMIMAPER cluster meter count transform failed: ${label} end`);
  return code.slice(0, startIndex) + replacement + code.slice(endIndex);
};

export const amimapClusterMeterCountPlugin = () => ({
  name: "amimap-cluster-meter-count",
  enforce: "pre",
  transform(source, id) {
    if (!id.endsWith("/src/main.jsx") && !id.endsWith("\\src\\main.jsx")) return null;
    let code = source;

    const start = "        grouped.forEach((group) => {";
    const end = "        markersRef.current = proxyMarkers;";

    const replacement = [
      "        // 클러스터 숫자는 좌표 그룹 수가 아니라 현재 필터를 통과한 실제 계기 수를 사용합니다.",
      "        // 계기 1개당 가벼운 proxy Marker 1개를 넣으면 Kakao MarkerClusterer의 기본 숫자가 실제 계기 수와 일치합니다.",
      "        grouped.forEach((group) => {",
      "          const { coords, meterIds } = group;",
      "          const list = meterIds.map((id) => dataByMeterRef.current.get(id)).filter(Boolean);",
      "          if (!list.length) return;",
      "",
      "          // 기존 마커 개수 필터는 해당 좌표의 전체 계기 개수 기준을 그대로 유지",
      "          if (useSizeFilter && list.length < threshold) return;",
      "",
      "          const matchedRows = list.filter(rowPassesMapFilters);",
      "          if (!matchedRows.length) return;",
      "",
      "          const proxyPosition = new window.kakao.maps.LatLng(coords.lat, coords.lng);",
      "          for (const matchedRow of matchedRows) {",
      "            const matchedId = normalizeMeterId(matchedRow?.meter_id);",
      "            if (!matchedId) continue;",
      "",
      "            const marker = new window.kakao.maps.Marker({",
      "              position: proxyPosition,",
      "              image: proxyMarkerImage,",
      "              title: `${pickAddress(list[0]) || \"주소 없음\"} · 필터 계기 ${matchedRows.length}개 / 전체 ${list.length}개`,",
      "              clickable: true,",
      "            });",
      "            marker.__meterIds = [matchedId];",
      "            marker.__groupMeterIds = meterIds;",
      "            marker.__meterCount = 1;",
      "            window.kakao.maps.event.addListener(marker, \"click\", () => {",
      "              map.setCenter(proxyPosition);",
      "              map.setLevel(CLUSTER_MODE_LEVEL - 1);",
      "            });",
      "            proxyMarkers.push(marker);",
      "          }",
      "        });",
      "",
    ].join("\n");

    code = replaceRangeRequired(code, start, end, replacement, "actual meter count proxies");
    return { code, map: null };
  },
});
