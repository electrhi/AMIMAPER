const replaceRequired = (code, target, replacement, label) => {
  if (!code.includes(target)) throw new Error(`AMIMAPER popup stability transform failed: ${label}`);
  return code.replace(target, replacement);
};

export const amimapPopupStabilityPlugin = () => ({
  name: "amimap-popup-stability",
  enforce: "pre",
  transform(source, id) {
    if (!id.endsWith("/src/main.jsx") && !id.endsWith("\\src\\main.jsx")) return null;
    let code = source;

    code = replaceRequired(
      code,
      [
        '        const openPopup = async (e) => {',
        '          e.stopPropagation();',
      ].join("\n"),
      [
        '        const openPopup = async (e) => {',
        '          e?.preventDefault?.();',
        '          e?.stopPropagation?.();',
        '          e?.stopImmediatePropagation?.();',
      ].join("\n"),
      "popup open event isolation"
    );

    code = replaceRequired(
      code,
      [
        '          // ✕ 닫기 버튼',
        '          const closeBtn = document.createElement("button");',
      ].join("\n"),
      [
        '          // 팝업 내부 조작이 지도/마커 이벤트로 번지지 않도록 차단',
        '          const stopPopupPropagation = (event) => {',
        '            event?.stopPropagation?.();',
        '          };',
        '          popupEl.addEventListener("pointerdown", stopPopupPropagation);',
        '          popupEl.addEventListener("pointerup", stopPopupPropagation);',
        '          popupEl.addEventListener("click", stopPopupPropagation);',
        '',
        '          // ✕ 닫기 버튼',
        '          const closeBtn = document.createElement("button");',
      ].join("\n"),
      "popup propagation shield"
    );

    code = replaceRequired(
      code,
      [
        '          closeBtn.addEventListener("click", (e) => {',
        '            e.stopPropagation();',
        '            const ov = getActiveOverlay();',
        '            if (ov) {',
        '              ov.setMap(null);',
        '              setActiveOverlay(null);',
        '              debugLog("[DEBUG][POPUP] ✕ 버튼 클릭 — 팝업 닫힘");',
        '            }',
        '          });',
      ].join("\n"),
      [
        '          closeBtn.addEventListener("pointerdown", (e) => {',
        '            e.stopPropagation();',
        '            e.stopImmediatePropagation?.();',
        '          });',
        '          closeBtn.addEventListener("click", (e) => {',
        '            e.preventDefault();',
        '            e.stopPropagation();',
        '            e.stopImmediatePropagation?.();',
        '            const ov = getActiveOverlay();',
        '            if (ov) {',
        '              ov.setMap(null);',
        '              setActiveOverlay(null);',
        '            }',
        '            debugLog("[DEBUG][POPUP] ✕ 버튼 클릭 — 팝업 닫힘");',
        '          });',
      ].join("\n"),
      "popup close event isolation"
    );

    // pointerdown에서 팝업을 만들면 같은 탭 동작의 후속 click 이벤트와 경합할 수 있습니다.
    // 일반 click으로 열어 모바일/PC 모두 한 번의 완성된 탭 뒤에 팝업을 생성합니다.
    code = replaceRequired(
      code,
      '        markerEl.addEventListener("pointerdown", openPopup);',
      '        markerEl.addEventListener("click", openPopup);',
      "marker popup click binding"
    );

    return { code, map: null };
  },
});
