export const amimapMapTypeLabelPlugin = () => ({
  name: "amimap-map-type-label",
  enforce: "pre",
  transform(source, id) {
    if (!id.endsWith("/src/main.jsx") && !id.endsWith("\\src\\main.jsx")) return null;

    const target = '        🗺️ 지도 전환 ({mapType === "ROADMAP" ? "스카이뷰" : "일반"})';
    const replacement = '        {mapType === "ROADMAP" ? "스카이뷰" : "일반"}';

    if (!source.includes(target)) {
      throw new Error("AMIMAPER map type label transform failed: target label not found");
    }

    return {
      code: source.replace(target, replacement),
      map: null,
    };
  },
});
