const replaceRequired = (code, target, replacement, label) => {
  if (!code.includes(target)) {
    throw new Error(`AMIMAPER top actions layout transform failed: ${label}`);
  }
  return code.replace(target, replacement);
};

export const amimapTopActionsLayoutPlugin = () => ({
  name: "amimap-top-actions-layout",
  enforce: "pre",
  transform(source, id) {
    if (!id.endsWith("/src/main.jsx") && !id.endsWith("\\src\\main.jsx")) return null;

    // 기본 레이아웃(세로)을 그대로 유지해서 로그아웃 아래에 +추가 버튼이 오도록 합니다.
    // +추가 버튼만 로그아웃 버튼보다 살짝 작게 표시합니다.
    const addButtonStyleTarget = [
      '          style={{',
      '            padding: "10px 14px",',
      '            borderRadius: "10px",',
      '            border: "none",',
      '            background: isAddMarkerMode ? "#dc3545" : "#28a745",',
      '            color: "white",',
      '            cursor: "pointer",',
      '            fontWeight: 800,',
      '            boxShadow: "0 2px 8px rgba(0,0,0,0.25)",',
      '          }}',
    ].join("\n");

    const addButtonStyleReplacement = [
      '          style={{',
      '            padding: "8px 11px",',
      '            borderRadius: "9px",',
      '            border: "none",',
      '            background: isAddMarkerMode ? "#dc3545" : "#28a745",',
      '            color: "white",',
      '            cursor: "pointer",',
      '            fontWeight: 800,',
      '            fontSize: "12px",',
      '            boxShadow: "0 2px 8px rgba(0,0,0,0.25)",',
      '          }}',
    ].join("\n");

    const code = replaceRequired(
      source,
      addButtonStyleTarget,
      addButtonStyleReplacement,
      "smaller add marker button"
    );

    return { code, map: null };
  },
});
