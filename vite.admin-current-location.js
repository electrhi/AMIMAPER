const replaceRequired = (code, target, replacement, label) => {
  if (!code.includes(target)) {
    throw new Error(`AMIMAPER admin current location transform failed: ${label}`);
  }
  return code.replace(target, replacement);
};

export const amimapAdminCurrentLocationPlugin = () => ({
  name: "amimap-admin-current-location",
  enforce: "pre",
  transform(source, id) {
    if (!id.endsWith("/src/main.jsx") && !id.endsWith("\\src\\main.jsx")) return null;

    let code = source;

    // 기존 '내 위치' 이동 함수를 관리자도 사용할 수 있게 허용
    code = replaceRequired(
      code,
      '    if (!map || isAdmin || !window.kakao?.maps) return;',
      '    if (!map || !window.kakao?.maps) return;',
      "allow admin current location"
    );

    // 오른쪽 아래 '관리자 모드' 표시를 클릭 가능한 현재 위치 버튼으로 변경
    const adminModeTarget = [
      "      {isAdmin && (",
      "        <div",
      "          style={{",
      '            position: "fixed",',
      "            bottom: 20,",
      "            right: 20,",
      "            zIndex: 999999,",
      '            background: "rgba(128,0,128,0.8)",',
      '            color: "white",',
      '            padding: "8px 12px",',
      '            borderRadius: "8px",',
      '            fontWeight: "bold",',
      '            fontSize: "14px",',
      '            boxShadow: "0 2px 6px rgba(0,0,0,0.3)",',
      "          }}",
      "        >",
      "          👑 관리자 모드",
      "        </div>",
      "      )}",
    ].join("\n");

    const adminModeReplacement = [
      "      {isAdmin && (",
      "        <button",
      '          type="button"',
      "          onClick={moveToMyCurrentLocation}",
      '          aria-label="내 위치로 이동"',
      '          title="내 위치로 이동"',
      "          style={{",
      '            position: "fixed",',
      "            bottom: 20,",
      "            right: 20,",
      "            zIndex: 999999,",
      '            background: "rgba(128,0,128,0.8)",',
      '            color: "white",',
      '            padding: "8px 12px",',
      '            borderRadius: "8px",',
      '            border: "none",',
      '            fontWeight: "bold",',
      '            fontSize: "14px",',
      '            fontFamily: "inherit",',
      '            cursor: "pointer",',
      '            boxShadow: "0 2px 6px rgba(0,0,0,0.3)",',
      "          }}",
      "        >",
      "          👑 관리자 모드",
      "        </button>",
      "      )}",
    ].join("\n");

    code = replaceRequired(
      code,
      adminModeTarget,
      adminModeReplacement,
      "admin mode current location button"
    );

    return { code, map: null };
  },
});
