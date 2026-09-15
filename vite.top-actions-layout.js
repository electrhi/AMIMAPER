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

    const target = [
      '          display: "flex",',
      '          flexDirection: "column",',
      '          gap: 8,',
      '          alignItems: "flex-end",',
    ].join("\n");

    const replacement = [
      '          display: "flex",',
      '          flexDirection: "row-reverse",',
      '          gap: 8,',
      '          alignItems: "center",',
    ].join("\n");

    const code = replaceRequired(
      source,
      target,
      replacement,
      "right-top add/logout buttons"
    );

    return { code, map: null };
  },
});
