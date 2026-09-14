const replaceRequired = (code, target, replacement, label) => {
  if (!code.includes(target)) {
    throw new Error(`AMIMAPER safe address transform failed: ${label}`);
  }
  return code.replace(target, replacement);
};

export const amimapSafeAddressMatchPlugin = () => ({
  name: "amimap-safe-address-match",
  enforce: "pre",
  transform(source, id) {
    if (!id.endsWith("/src/main.jsx") && !id.endsWith("\\src\\main.jsx")) return null;
    let code = source;

    // geoCache의 원본 주소도 함께 보관해 지번(예: 93-5 / 93-51 / 93-52)을 안전하게 비교합니다.
    code = replaceRequired(
      code,
      '    const entries = Object.entries(geoCache).map(([key, value]) => [normalizeAddr(key), value]);',
      [
        '    const extractLotNumber = (value) => {',
        '      const text = String(value ?? "")',
        '        .replace(/[\\u00a0\\u3000]/g, " ")',
        '        .replace(/번지/g, " ")',
        '        .replace(/\\s+/g, " ")',
        '        .trim();',
        '      if (!text) return "";',
        '',
        '      const tokens = text.match(/(?:산\\s*)?\\d+(?:\\s*-\\s*\\d+)?(?=\\s|$)/g) || [];',
        '      if (tokens.length) return tokens[tokens.length - 1].replace(/\\s+/g, "");',
        '',
        '      const compact = text.replace(/\\s+/g, "");',
        '      return compact.match(/(?:산)?\\d+(?:-\\d+)?$/)?.[0] || "";',
        '    };',
        '',
        '    const safeAddressContains = (container, candidate) => {',
        '      const outer = String(container ?? "");',
        '      const inner = String(candidate ?? "");',
        '      if (!outer || !inner) return false;',
        '',
        '      let fromIndex = 0;',
        '      while (fromIndex <= outer.length - inner.length) {',
        '        const index = outer.indexOf(inner, fromIndex);',
        '        if (index < 0) return false;',
        '',
        '        const before = index > 0 ? outer[index - 1] : "";',
        '        const afterIndex = index + inner.length;',
        '        const after = afterIndex < outer.length ? outer[afterIndex] : "";',
        '        const first = inner[0] || "";',
        '        const last = inner[inner.length - 1] || "";',
        '',
        '        const cutsNumberOnLeft = /\\d/.test(first) && /[\\d-]/.test(before);',
        '        const cutsNumberOnRight = /\\d/.test(last) && /[\\d-]/.test(after);',
        '        if (!cutsNumberOnLeft && !cutsNumberOnRight) return true;',
        '        fromIndex = index + 1;',
        '      }',
        '      return false;',
        '    };',
        '',
        '    const entries = Object.entries(geoCache).map(([key, value]) => [normalizeAddr(key), value, key]);',
      ].join("\n"),
      "safe geo cache entries"
    );

    code = replaceRequired(
      code,
      '      const addr = normalizeAddr(row?.address);\n      if (!addr) return row;\n      let value = exactMap.get(addr) || null;',
      '      const addr = normalizeAddr(row?.address);\n      if (!addr) return row;\n      const rowLotNumber = extractLotNumber(row?.address);\n      let value = exactMap.get(addr) || null;',
      "row lot number"
    );

    code = replaceRequired(
      code,
      '        const partial = entries.find(([key]) => key && (key.includes(addr) || addr.includes(key)));',
      [
        '        const partial = entries.find(([key, , rawKey]) => {',
        '          if (!key) return false;',
        '          const cacheLotNumber = extractLotNumber(rawKey);',
        '          if (rowLotNumber && cacheLotNumber && rowLotNumber !== cacheLotNumber) return false;',
        '          return safeAddressContains(key, addr) || safeAddressContains(addr, key);',
        '        });',
      ].join("\n"),
      "safe partial address match"
    );

    code = replaceRequired(
      code,
      '        const similar = entries.find(([key]) => key && key.includes(dongName) && key.slice(-5) === addr.slice(-5));',
      [
        '        const similar = entries.find(([key, , rawKey]) => {',
        '          if (!key) return false;',
        '          const cacheLotNumber = extractLotNumber(rawKey);',
        '          if (rowLotNumber && cacheLotNumber && rowLotNumber !== cacheLotNumber) return false;',
        '          return key.includes(dongName) && key.slice(-5) === addr.slice(-5);',
        '        });',
      ].join("\n"),
      "safe similar address match"
    );

    return { code, map: null };
  },
});
