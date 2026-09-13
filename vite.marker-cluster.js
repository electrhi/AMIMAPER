const replaceRequired = (code, target, replacement, label) => {
  if (!code.includes(target)) throw new Error(`AMIMAPER cluster transform failed: ${label}`);
  return code.replace(target, replacement);
};

const insertAfterRequired = (code, target, addition, label) =>
  replaceRequired(code, target, `${target}\n${addition}`, label);

export const amimapMarkerClusterPlugin = () => ({
  name: "amimap-marker-cluster",
  enforce: "pre",
  transform(source, id) {
    if (!id.endsWith("/src/main.jsx") && !id.endsWith("\\src\\main.jsx")) return null;
    let code = source;

    code = replaceRequired(
      code,
      "&autoload=false&libraries=services`",
      "&autoload=false&libraries=services,clusterer`",
      "clusterer sdk library"
    );

    code = insertAfterRequired(
      code,
      "  const LABEL_SHOW_LEVEL = 5;",
      [
        "  const CLUSTER_MODE_LEVEL = 5;",
        "  const clustererRef = useRef(null);",
        "  const clusterModeRef = useRef(false);",
      ].join("\n"),
      "cluster refs"
    );

    code = replaceRequired(
      code,
      "    overlayByKeyRef.current.clear();\n    markerGroupCacheRef.current.clear();",
      [
        "    try { clustererRef.current?.clear?.(); } catch {}",
        "    clustererRef.current = null;",
        "    clusterModeRef.current = false;",
        "    overlayByKeyRef.current.clear();",
        "    markerGroupCacheRef.current.clear();",
      ].join("\n"),
      "cluster logout cleanup"
    );

    code = replaceRequired(
      code,
      "      // 기존 마커 제거\n      markersRef.current.forEach((m) => m.setMap(null));",
      [
        "      // 기존 클러스터/마커 제거",
        "      try { clustererRef.current?.clear?.(); } catch {}",
        "      clustererRef.current = null;",
        "      markersRef.current.forEach((m) => m.setMap(null));",
      ].join("\n"),
      "cluster render cleanup"
    );

    const clusterBlock = [
      "      const shouldCluster =",
      "        map.getLevel() >= CLUSTER_MODE_LEVEL &&",
      "        typeof window.kakao?.maps?.MarkerClusterer === \"function\";",
      "",
      "      if (shouldCluster) {",
      "        clusterModeRef.current = true;",
      "        const proxyMarkers = [];",
      "",
      "        grouped.forEach((group) => {",
      "          const { coords, meterIds } = group;",
      "          const list = meterIds.map((id) => dataByMeterRef.current.get(id)).filter(Boolean);",
      "          if (!list.length || !list.some(rowPassesMapFilters)) return;",
      "",
      "          const marker = new window.kakao.maps.Marker({",
      "            position: new window.kakao.maps.LatLng(coords.lat, coords.lng),",
      "            title: `${pickAddress(list[0]) || \"주소 없음\"} · 계기 ${list.length}개`,",
      "            clickable: false,",
      "          });",
      "          marker.__meterIds = meterIds;",
      "          marker.__meterCount = list.length;",
      "          proxyMarkers.push(marker);",
      "        });",
      "",
      "        markersRef.current = proxyMarkers;",
      "        const clusterer = new window.kakao.maps.MarkerClusterer({",
      "          map,",
      "          markers: proxyMarkers,",
      "          gridSize: 60,",
      "          averageCenter: true,",
      "          minLevel: CLUSTER_MODE_LEVEL,",
      "          minClusterSize: 2,",
      "          disableClickZoom: false,",
      "          clickable: true,",
      "          hoverable: false,",
      "          calculator: [10, 50, 200],",
      "          styles: [",
      "            { width: \"36px\", height: \"36px\", background: \"rgba(17,24,39,0.90)\", borderRadius: \"18px\", color: \"#fff\", textAlign: \"center\", fontWeight: \"900\", lineHeight: \"36px\", boxShadow: \"0 2px 8px rgba(0,0,0,0.28)\" },",
      "            { width: \"42px\", height: \"42px\", background: \"rgba(17,24,39,0.90)\", borderRadius: \"21px\", color: \"#fff\", textAlign: \"center\", fontWeight: \"900\", lineHeight: \"42px\", boxShadow: \"0 2px 9px rgba(0,0,0,0.30)\" },",
      "            { width: \"48px\", height: \"48px\", background: \"rgba(17,24,39,0.92)\", borderRadius: \"24px\", color: \"#fff\", textAlign: \"center\", fontWeight: \"900\", lineHeight: \"48px\", boxShadow: \"0 3px 10px rgba(0,0,0,0.32)\" },",
      "            { width: \"54px\", height: \"54px\", background: \"rgba(17,24,39,0.94)\", borderRadius: \"27px\", color: \"#fff\", textAlign: \"center\", fontWeight: \"900\", lineHeight: \"54px\", boxShadow: \"0 3px 12px rgba(0,0,0,0.35)\" },",
      "          ],",
      "        });",
      "        clustererRef.current = clusterer;",
      "        debugLog(`[DEBUG][MAP] ✅ 클러스터 모드: 좌표 마커 ${proxyMarkers.length}개`);",
      "        return;",
      "      }",
      "",
      "      clusterModeRef.current = false;",
      "      let markerCount = 0;",
    ].join("\n");

    code = replaceRequired(code, "      let markerCount = 0;", clusterBlock, "cluster render branch");

    code = replaceRequired(
      code,
      "  const updateMarkerColorsByMeterIds = (meterIds, latestMap = null) => {\n    if (!meterIds || meterIds.length === 0) return;",
      [
        "  const updateMarkerColorsByMeterIds = (meterIds, latestMap = null) => {",
        "    if (!meterIds || meterIds.length === 0) return;",
        "    if (clusterModeRef.current) {",
        "      requestFullRender.current();",
        "      return;",
        "    }",
      ].join("\n"),
      "cluster realtime refresh"
    );

    const modeEffect = [
      "",
      "  // ✅ Kakao MarkerClusterer ↔ 기존 CustomOverlay 모드 전환",
      "  useEffect(() => {",
      "    if (!map || !window.kakao?.maps) return;",
      "    let lastShouldCluster = map.getLevel() >= CLUSTER_MODE_LEVEL;",
      "    clusterModeRef.current = lastShouldCluster;",
      "",
      "    const handleClusterModeLevel = () => {",
      "      const nextShouldCluster = map.getLevel() >= CLUSTER_MODE_LEVEL;",
      "      if (nextShouldCluster === lastShouldCluster) return;",
      "      lastShouldCluster = nextShouldCluster;",
      "      clusterModeRef.current = nextShouldCluster;",
      "      requestFullRender.current();",
      "    };",
      "",
      "    window.kakao.maps.event.addListener(map, \"zoom_changed\", handleClusterModeLevel);",
      "    return () => {",
      "      try { window.kakao.maps.event.removeListener(map, \"zoom_changed\", handleClusterModeLevel); } catch {}",
      "    };",
      "  }, [map]);",
      "",
    ].join("\n");

    code = replaceRequired(
      code,
      "    const clearCustomMarkerObjects = () => {",
      `${modeEffect}    const clearCustomMarkerObjects = () => {`,
      "cluster mode level effect"
    );

    return { code, map: null };
  },
});
