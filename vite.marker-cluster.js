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
      "    meterToKeyRef.current.clear();\n    markerGroupCacheRef.current.clear();",
      [
        "    try { clustererRef.current?.clear?.(); } catch {}",
        "    clustererRef.current = null;",
        "    clusterModeRef.current = false;",
        "    meterToKeyRef.current.clear();",
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
      "        const proxyMarkerSvg = '<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"34\" height=\"34\" viewBox=\"0 0 34 34\"><circle cx=\"17\" cy=\"17\" r=\"14\" fill=\"#2563eb\" stroke=\"#ffffff\" stroke-width=\"3\"/><circle cx=\"17\" cy=\"17\" r=\"5\" fill=\"#dbeafe\"/></svg>';",
      "        const proxyMarkerImage = new window.kakao.maps.MarkerImage(",
      "          `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(proxyMarkerSvg)}` ,",
      "          new window.kakao.maps.Size(34, 34),",
      "          { offset: new window.kakao.maps.Point(17, 17) }",
      "        );",
      "",
      "        grouped.forEach((group) => {",
      "          const { coords, meterIds } = group;",
      "          const list = meterIds.map((id) => dataByMeterRef.current.get(id)).filter(Boolean);",
      "          if (!list.length || !list.some(rowPassesMapFilters)) return;",
      "",
      "          const proxyPosition = new window.kakao.maps.LatLng(coords.lat, coords.lng);",
      "          const marker = new window.kakao.maps.Marker({",
      "            position: proxyPosition,",
      "            image: proxyMarkerImage,",
      "            title: `${pickAddress(list[0]) || \"주소 없음\"} · 계기 ${list.length}개`,",
      "            clickable: true,",
      "          });",
      "          marker.__meterIds = meterIds;",
      "          marker.__meterCount = list.length;",
      "          window.kakao.maps.event.addListener(marker, \"click\", () => {",
      "            map.setCenter(proxyPosition);",
      "            map.setLevel(CLUSTER_MODE_LEVEL - 1);",
      "          });",
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
      "            { width: \"38px\", height: \"38px\", background: \"linear-gradient(135deg,#3b82f6 0%,#1d4ed8 100%)\", border: \"2px solid rgba(255,255,255,0.96)\", borderRadius: \"50%\", color: \"#fff\", textAlign: \"center\", fontWeight: \"900\", fontSize: \"13px\", lineHeight: \"34px\", boxShadow: \"0 3px 10px rgba(30,64,175,0.40)\" },",
      "            { width: \"44px\", height: \"44px\", background: \"linear-gradient(135deg,#2563eb 0%,#1e40af 100%)\", border: \"2px solid rgba(255,255,255,0.96)\", borderRadius: \"50%\", color: \"#fff\", textAlign: \"center\", fontWeight: \"900\", fontSize: \"13px\", lineHeight: \"40px\", boxShadow: \"0 4px 12px rgba(30,64,175,0.42)\" },",
      "            { width: \"50px\", height: \"50px\", background: \"linear-gradient(135deg,#1d4ed8 0%,#172554 100%)\", border: \"2px solid rgba(255,255,255,0.98)\", borderRadius: \"50%\", color: \"#fff\", textAlign: \"center\", fontWeight: \"900\", fontSize: \"14px\", lineHeight: \"46px\", boxShadow: \"0 5px 14px rgba(30,58,138,0.46)\" },",
      "            { width: \"56px\", height: \"56px\", background: \"linear-gradient(135deg,#1e3a8a 0%,#0f172a 100%)\", border: \"2px solid rgba(255,255,255,0.98)\", borderRadius: \"50%\", color: \"#fff\", textAlign: \"center\", fontWeight: \"900\", fontSize: \"15px\", lineHeight: \"52px\", boxShadow: \"0 6px 16px rgba(15,23,42,0.50)\" },",
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
