const replaceRequired = (code, target, replacement, label) => {
  if (!code.includes(target)) {
    throw new Error(`AMIMAPER 계기표시 변환 실패: ${label} 대상 코드를 찾지 못했습니다.`);
  }
  return code.replace(target, replacement);
};

export const meterLabelModePlugin = () => ({
  name: "amimap-meter-label-view-mode",
  enforce: "pre",
  transform(source, id) {
    if (!id.endsWith("/src/main.jsx") && !id.endsWith("\\src\\main.jsx")) {
      return null;
    }

    let code = source;

    // 지번/도로명 2단 토글을 지번/도로명/계기 3단 표시 모드로 변경
    code = replaceRequired(
      code,
      'const [useRoadAddress, setUseRoadAddress] = useState(false);',
      [
        'const [addressLabelMode, setAddressLabelMode] = useState("jibun");',
        'const useRoadAddress = addressLabelMode === "road";',
      ].join("\n"),
      "주소 표시 모드 state"
    );

    // 계기 -> 지번 전환에서도 반드시 마커 라벨을 다시 그리도록 표시 모드를 dependency로 사용
    code = replaceRequired(
      code,
      '  }, [statusFilters, meterTypeFilters, commTypeFilters, showAddressLabels, useRoadAddress]);',
      '  }, [statusFilters, meterTypeFilters, commTypeFilters, showAddressLabels, addressLabelMode]);',
      "주소 표시 모드 렌더 dependency"
    );

    code = replaceRequired(
      code,
      '      onClick={() => setUseRoadAddress((v) => !v)}',
      [
        '      onClick={() =>',
        '        setAddressLabelMode((mode) =>',
        '          mode === "jibun" ? "road" : mode === "road" ? "meter" : "jibun"',
        '        )',
        '      }',
      ].join("\n"),
      "지번/도로명/계기 버튼 동작"
    );

    code = replaceRequired(
      code,
      '        background: useRoadAddress ? "#f1f3f5" : "#fff",',
      '        background: addressLabelMode === "jibun" ? "#fff" : "#f1f3f5",',
      "표시 모드 버튼 배경"
    );

    code = replaceRequired(
      code,
      '      {useRoadAddress ? "도로명" : "지번"}',
      '      {addressLabelMode === "jibun" ? "지번" : addressLabelMode === "road" ? "도로명" : "계기"}',
      "표시 모드 버튼 문구"
    );

    // 앞 단계에서 만든 계기타입 요약을 주소 아래 두 번째 줄로 붙이지 않고,
    // "계기" 모드일 때 주소가 있던 자리 자체에 표시한다.
    const oldSummaryRender = [
      '  if (typeSummary) {',
      '    const typeDiv = document.createElement("div");',
      '    typeDiv.textContent = typeSummary;',
      '    typeDiv.style.cssText = "margin-top:2px; font-weight:900; text-align:center;";',
      '    labelEl.appendChild(typeDiv);',
      '  }',
    ].join("\n");

    const newSummaryRender = [
      '  if (addressLabelMode === "meter") {',
      '    addrDiv.textContent = typeSummary || "-";',
      '    addrDiv.style.textAlign = "center";',
      '  }',
    ].join("\n");

    code = replaceRequired(
      code,
      oldSummaryRender,
      newSummaryRender,
      "계기 모드 라벨 내용"
    );

    return { code, map: null };
  },
});
