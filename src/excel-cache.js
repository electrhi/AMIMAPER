import * as XLSX from "xlsx";

const workbookPromiseCache = new Map();
const rowsPromiseCache = new Map();

const normalizeFileName = (fileName) => String(fileName ?? "").trim();

const makeRowsCacheKey = (fileName, raw, defval) =>
  `${fileName}::raw=${raw ? "1" : "0"}::defval=${defval === undefined ? "__UNDEF__" : String(defval)}`;

const getWorkbook = async (fileName, downloadExcel, { force = false } = {}) => {
  const normalized = normalizeFileName(fileName);
  if (!normalized) throw new Error("Excel 파일명이 비어 있습니다.");
  if (typeof downloadExcel !== "function") throw new Error("Excel 다운로드 함수가 필요합니다.");

  if (force) workbookPromiseCache.delete(normalized);

  const cached = workbookPromiseCache.get(normalized);
  if (cached) return cached;

  const promise = (async () => {
    const excelBlob = await downloadExcel(normalized);
    const arrayBuffer = await excelBlob.arrayBuffer();
    return XLSX.read(arrayBuffer, { type: "array" });
  })();

  workbookPromiseCache.set(normalized, promise);

  try {
    return await promise;
  } catch (error) {
    if (workbookPromiseCache.get(normalized) === promise) workbookPromiseCache.delete(normalized);
    throw error;
  }
};

export const loadExcelRows = async (
  fileName,
  downloadExcel,
  { raw = true, defval = undefined, force = false } = {}
) => {
  const normalized = normalizeFileName(fileName);
  if (!normalized) return [];

  if (force) {
    workbookPromiseCache.delete(normalized);
    for (const key of Array.from(rowsPromiseCache.keys())) {
      if (key.startsWith(`${normalized}::`)) rowsPromiseCache.delete(key);
    }
  }

  const cacheKey = makeRowsCacheKey(normalized, raw, defval);
  const cached = rowsPromiseCache.get(cacheKey);
  if (cached) return cached;

  const promise = (async () => {
    const workbook = await getWorkbook(normalized, downloadExcel);
    const firstSheetName = workbook.SheetNames?.[0];
    if (!firstSheetName) return [];

    const sheet = workbook.Sheets[firstSheetName];
    const options = { raw };
    if (defval !== undefined) options.defval = defval;
    return XLSX.utils.sheet_to_json(sheet, options);
  })();

  rowsPromiseCache.set(cacheKey, promise);

  try {
    return await promise;
  } catch (error) {
    if (rowsPromiseCache.get(cacheKey) === promise) rowsPromiseCache.delete(cacheKey);
    throw error;
  }
};

export const invalidateExcelCache = (fileName = null) => {
  const normalized = normalizeFileName(fileName);

  if (!normalized) {
    workbookPromiseCache.clear();
    rowsPromiseCache.clear();
    return;
  }

  workbookPromiseCache.delete(normalized);
  for (const key of Array.from(rowsPromiseCache.keys())) {
    if (key.startsWith(`${normalized}::`)) rowsPromiseCache.delete(key);
  }
};
