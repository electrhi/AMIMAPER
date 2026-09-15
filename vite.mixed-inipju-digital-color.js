const replaceRequired = (code, target, replacement, label) => {
  if (!code.includes(target)) {
    throw new Error(`AMIMAPER mixed inipju digital color transform failed: ${label}`);
  }
  return code.replace(target, replacement);
};

const insertAfterRequired = (code, target, addition, label) =>
  replaceRequired(code, target, `${target}\n${addition}`, label);

export const amimapMixedInipjuDigitalColorPlugin = () => ({
  name: "amimap-mixed-inipju-digital-color",
  enforce: "pre",
  transform(source, id) {
    if (!id.endsWith("/src/main.jsx") && !id.endsWith("\\src\\main.jsx")) return null;

    let code = source;

    code = insertAfterRequired(
      code,
      '  const DEFAULT_UNVISITED_ORANGE = "#ff8c00";',
      [
        "",
        "  // ✅ 같은 좌표의 한 마커 안에서 인입주전산화 값이 서로 다르면 강조 표시",
        "  const hasMixedInipjuDigitalValues = (rows) => {",
        "    const values = new Set();",
        "    for (const row of rows || []) {",
        "      const value = String(row?.inipju_digital ?? \"\")",
        "        .trim()",
        "        .replace(/\\s+/g, \" \" );",
        "      values.add(value);",
        "      if (values.size > 1) return true;",
        "    }",
        "    return false;",
        "  };",
      ].join("\n"),
      "mixed inipju helper"
    );

    code = replaceRequired(
      code,
      [
        "        // ✅ 이 좌표 그룹에 농사/농사용이 하나라도 있으면 true",
        "        const hasFarming = list.some((r) => isFarmingContract(r?.contract_type));",
        "        ",
        "        const color = getMarkerColor(진행, hasFarming);",
      ].join("\n"),
      [
        "        // ✅ 이 좌표 그룹에 농사/농사용이 하나라도 있으면 true",
        "        const hasFarming = list.some((r) => isFarmingContract(r?.contract_type));",
        "        // ✅ 동일 좌표 그룹의 인입주전산화가 서로 다르면 파란색 강조",
        "        //    단, 완료/불가는 작업 상태색(초록/빨강)을 최우선으로 표시",
        "        const hasMixedInipjuDigital = hasMixedInipjuDigitalValues(list);",
        "        const normalizedMarkerStatus = normalizeStatusValue(진행);",
        "        const color =",
        "          normalizedMarkerStatus === \"완료\" || normalizedMarkerStatus === \"불가\"",
        "            ? getMarkerColor(normalizedMarkerStatus, hasFarming)",
        "            : hasMixedInipjuDigital",
        "              ? \"blue\"",
        "              : getMarkerColor(normalizedMarkerStatus, hasFarming);",
      ].join("\n"),
      "initial marker color"
    );

    code = replaceRequired(
      code,
      "        overlay.__hasFarming = hasFarming;",
      [
        "        overlay.__hasFarming = hasFarming;",
        "        overlay.__hasMixedInipjuDigital = hasMixedInipjuDigital;",
      ].join("\n"),
      "marker mixed metadata"
    );

    code = replaceRequired(
      code,
      [
        "    const hasFarming = !!overlay.__hasFarming; // ✅ 마커 생성 시 저장한 값 사용",
        "    el.style.background = getMarkerColor(status, hasFarming);",
      ].join("\n"),
      [
        "    const hasFarming = !!overlay.__hasFarming; // ✅ 마커 생성 시 저장한 값 사용",
        "    const hasMixedInipjuDigital = !!overlay.__hasMixedInipjuDigital;",
        "    const normalizedMarkerStatus = normalizeStatusValue(status);",
        "    el.style.background =",
        "      normalizedMarkerStatus === \"완료\" || normalizedMarkerStatus === \"불가\"",
        "        ? getMarkerColor(normalizedMarkerStatus, hasFarming)",
        "        : hasMixedInipjuDigital",
        "          ? \"blue\"",
        "          : getMarkerColor(normalizedMarkerStatus, hasFarming);",
      ].join("\n"),
      "status refresh marker color"
    );

    // 기존 보조 partial updater가 호출되더라도 동일 규칙을 유지합니다.
    code = replaceRequired(
      code,
      [
        "      const hasFarming = !!overlay.__hasFarming;",
        "      const color = getMarkerColor(newStatus, hasFarming);",
      ].join("\n"),
      [
        "      const hasFarming = !!overlay.__hasFarming;",
        "      const hasMixedInipjuDigital = !!overlay.__hasMixedInipjuDigital;",
        "      const normalizedMarkerStatus = normalizeStatusValue(newStatus);",
        "      const color =",
        "        normalizedMarkerStatus === \"완료\" || normalizedMarkerStatus === \"불가\"",
        "          ? getMarkerColor(normalizedMarkerStatus, hasFarming)",
        "          : hasMixedInipjuDigital",
        "            ? \"blue\"",
        "            : getMarkerColor(normalizedMarkerStatus, hasFarming);",
      ].join("\n"),
      "partial marker color"
    );

    return { code, map: null };
  },
});