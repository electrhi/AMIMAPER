const replaceRequired = (code, target, replacement, label) => {
  if (!code.includes(target)) {
    throw new Error(`AMIMAPER comm label transform failed: ${label}`);
  }
  return code.replace(target, replacement);
};

export const amimapCommLabelModePlugin = () => ({
  name: "amimap-comm-label-mode",
  enforce: "pre",
  transform(source, id) {
    if (!id.endsWith("/src/main.jsx") && !id.endsWith("\\src\\main.jsx")) return null;
    let code = source;

    // 지번 -> 도로명 -> 계기 -> 통신방식 -> 지번 순환
    code = replaceRequired(
      code,
      '          mode === "jibun" ? "road" : mode === "road" ? "meter" : "jibun"',
      '          mode === "jibun" ? "road" : mode === "road" ? "meter" : mode === "meter" ? "comm" : "jibun"',
      "four step label mode cycle"
    );

    code = replaceRequired(
      code,
      '{addressLabelMode === "jibun" ? "지번" : addressLabelMode === "road" ? "도로명" : "계기"}',
      '{addressLabelMode === "jibun" ? "지번" : addressLabelMode === "road" ? "도로명" : addressLabelMode === "meter" ? "계기" : "통신방식"}',
      "communication label mode button text"
    );

    // 통신방식 모드: 동일 좌표의 전체 계기 기준으로 통신방식별 개수 요약
    code = replaceRequired(
      code,
      '  if (addressLabelMode === "meter") {',
      [
        '  if (addressLabelMode === "comm") {',
        '    const commCounts = new Map();',
        '    const preferredCommOrder = ["PLC", "LTE", "HPGP", "IOT"];',
        '',
        '    for (const meterRow of meterRows || []) {',
        '      const rawValue = getCommTypeFilterValue(meterRow);',
        '      const upperValue = String(rawValue || "미입력").trim().toUpperCase();',
        '      const label =',
        '        upperValue === "IOT"',
        '          ? "IoT"',
        '          : upperValue === "PLC" || upperValue === "LTE" || upperValue === "HPGP"',
        '            ? upperValue',
        '            : String(rawValue || "미입력").trim();',
        '      const key = upperValue || "미입력";',
        '      const current = commCounts.get(key);',
        '      if (current) current.count += 1;',
        '      else commCounts.set(key, { key, label, count: 1 });',
        '    }',
        '',
        '    const commSummary = Array.from(commCounts.values())',
        '      .sort((a, b) => {',
        '        const aIndex = preferredCommOrder.indexOf(a.key);',
        '        const bIndex = preferredCommOrder.indexOf(b.key);',
        '        if (aIndex >= 0 && bIndex >= 0) return aIndex - bIndex;',
        '        if (aIndex >= 0) return -1;',
        '        if (bIndex >= 0) return 1;',
        '        return a.label.localeCompare(b.label, "ko");',
        '      })',
        '      .map((item) => `${item.label}[${item.count}]`)',
        '      .join(" ");',
        '',
        '    const commDiv = document.createElement("div");',
        '    commDiv.textContent = commSummary || "-";',
        '    commDiv.style.cssText = "font-weight:900; text-align:center;";',
        '    labelEl.appendChild(commDiv);',
        '    return;',
        '  }',
        '',
        '  if (addressLabelMode === "meter") {',
      ].join("\n"),
      "communication label content"
    );

    // 미좌표 5개 항목 UI가 이미 적용된 경우 덮어쓰지 않습니다.
    // 구형 목록은 기존 플러그인의 표기 변경을 계속 지원합니다.
    const legacyNoCoordHeader = '(리스트번호 | 계기번호 | 주소)';
    const expandedNoCoordHeader = "(인입전산화 | 인입주 | 계기번호 | 계기타입 | 통신방식 | 주소)";
    if (code.includes(legacyNoCoordHeader)) {
      code = replaceRequired(
        code,
        legacyNoCoordHeader,
        '(인입전산화 | 계기번호 | 주소)',
        "no coordinate header"
      );
    } else if (!code.includes(expandedNoCoordHeader)) {
      throw new Error("AMIMAPER comm label transform failed: no coordinate header");
    }

    const legacyNoCoordValue = '{String(r?.inipju_digital ?? "-")} | {String(r?.meter_id ?? "-")} | {pickAddress(r) || "-"}';
    const expandedNoCoordValue = "{[\n                  String(r?.inipju_digital ?? \"\").trim() || \"-\",\n                  String(r?.inipju ?? \"\").trim() || \"-\",\n                  String(r?.meter_id ?? \"\").trim() || \"-\",\n                  getMeterType(r?.meter_id),\n                  String(r?.comm_type ?? \"\").trim() || \"-\",\n                  pickAddress(r) || \"-\",\n                ].join(\" | \")}";
    if (!code.includes(legacyNoCoordValue) && !code.includes(expandedNoCoordValue)) {
      throw new Error("AMIMAPER comm label transform failed: no coordinate inipju digital value");
    }

    return { code, map: null };
  },
});
