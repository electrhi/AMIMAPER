const replaceRequired = (code, target, replacement, label) => {
  if (!code.includes(target)) throw new Error(`AMIMAPER Excel transform failed: ${label}`);
  return code.replace(target, replacement);
};

const insertAfterRequired = (code, target, addition, label) =>
  replaceRequired(code, target, `${target}\n${addition}`, label);

export const amimapExcelPerformancePlugin = () => ({
  name: "amimap-excel-performance",
  enforce: "pre",
  transform(source, id) {
    const isMain = id.endsWith("/src/main.jsx") || id.endsWith("\\src\\main.jsx");
    const isPhoneSupport =
      id.endsWith("/src/phone-support.js") || id.endsWith("\\src\\phone-support.js");
    if (!isMain && !isPhoneSupport) return null;

    let code = source;
    code = insertAfterRequired(
      code,
      'import * as XLSX from "xlsx";',
      'import { loadExcelRows } from "./excel-cache.js";',
      "shared loader import"
    );

    if (isPhoneSupport) {
      const target = [
        '    const { data: excelBlob, error: downloadError } = await supabase.storage',
        '      .from("excels")',
        '      .download(fileName);',
        '',
        '    if (downloadError) throw downloadError;',
        '',
        '    const arrayBuffer = await excelBlob.arrayBuffer();',
        '    const workbook = XLSX.read(arrayBuffer, { type: "array" });',
        '    const sheet = workbook.Sheets[workbook.SheetNames[0]];',
        '    const rows = XLSX.utils.sheet_to_json(sheet, {',
        '      defval: "",',
        '      raw: false,',
        '    });',
      ].join("\n");

      const replacement = [
        '    const rows = await loadExcelRows(',
        '      fileName,',
        '      async (targetFile) => {',
        '        const { data: excelBlob, error: downloadError } = await supabase.storage',
        '          .from("excels")',
        '          .download(targetFile);',
        '        if (downloadError) throw downloadError;',
        '        return excelBlob;',
        '      },',
        '      { defval: "", raw: false, force }',
        '    );',
      ].join("\n");

      code = replaceRequired(code, target, replacement, "phone duplicate XLSX parse");
      return { code, map: null };
    }

    const target = [
      '      const { data: excelBlob, error } = await supabase.storage',
      '        .from("excels")',
      '        .download(fileName);',
      '      if (error) throw error;',
      '',
      '      const blob = await excelBlob.arrayBuffer();',
      '      const workbook = XLSX.read(blob, { type: "array" });',
      '      const sheet = workbook.Sheets[workbook.SheetNames[0]];',
      '      const json = XLSX.utils.sheet_to_json(sheet);',
    ].join("\n");

    const replacement = [
      '      const json = await loadExcelRows(',
      '        fileName,',
      '        async (targetFile) => {',
      '          const { data: excelBlob, error } = await supabase.storage',
      '            .from("excels")',
      '            .download(targetFile);',
      '          if (error) throw error;',
      '          return excelBlob;',
      '        },',
      '        { raw: true }',
      '      );',
    ].join("\n");

    code = replaceRequired(code, target, replacement, "main duplicate XLSX parse");
    return { code, map: null };
  },
});
