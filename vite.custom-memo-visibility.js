// 주소 ON/OFF에 기존 임의추가 마커의 메모 라벨만 연동합니다.
// 임의 마커 핀·편집·삭제·저장·동기화 로직은 변경하지 않습니다.
const replaceOnce = (code, before, after, label) => {
  const first = code.indexOf(before);
  if (first < 0 || code.indexOf(before, first + before.length) !== -1) {
    throw new Error("AMIMAPER custom memo toggle transform failed: " + label);
  }
  return code.replace(before, after);
};

export const amimapCustomMemoVisibilityPlugin = () => ({
  name: "amimap-custom-memo-visibility",
  enforce: "pre",
  transform(source, id) {
    if (!id.endsWith("/src/main.jsx") && !id.endsWith("\\src\\main.jsx")) return null;

    let code = source;

    // 최초 생성/갱신된 메모는 주소 ON인 경우에만 지도에 올립니다.
    code = replaceOnce(
      code,
      "       if (text) label.setMap(map);",
      "       if (text && showAddressLabels) label.setMap(map);",
      "custom marker initial memo visibility"
    );

    // 주소 토글만 변경할 때 마커와 편집창을 재생성하지 않고 메모만 표시/숨김 처리.
    code = replaceOnce(
      code,
      "  }, [map, customMarkers]);",
      `  }, [map, customMarkers]);

  // 주소 OFF일 때도 임의 마커 핀은 유지합니다. 메모 라벨만 숨깁니다.
  useEffect(() => {
    if (!map) return;
    customMarkerObjsRef.current.forEach(({ label, labelEl }) => {
      if (!label) return;
      const hasMemo = !!String(labelEl?.textContent ?? "").trim();
      try {
        label.setMap(showAddressLabels && hasMemo ? map : null);
      } catch (error) {
        debugWarn("[WARN][CUSTOM] memo visibility:", error?.message);
      }
    });
  }, [map, showAddressLabels]);`,
      "custom memo labels toggle effect"
    );

    return { code, map: null };
  },
});
