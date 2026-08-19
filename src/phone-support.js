import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const USER_ID_STORAGE_KEY = "amimap_user_id";
const PHONE_BUTTON_ATTR = "data-amimap-phone-button";
const PHONE_BUTTON_READY_ATTR = "data-amimap-phone-ready";
const POPUP_RESOLVED_ATTR = "data-amimap-phone-resolved";

let loadedUserId = "";
let loadedFileName = "";
let contactRows = [];
let preloadPromise = null;
let preloadTimer = null;
let kakaoPatchTimer = null;
const popupCoordByElement = new WeakMap();

const normalizeText = (value) =>
  String(value ?? "")
    .replace(/[\s\u00A0\u200B-\u200D\uFEFF]+/g, " ")
    .trim();

const normalizeMeterId = (value) =>
  String(value ?? "")
    .replace(/[\s\u00A0\u200B-\u200D\uFEFF]/g, "")
    .trim();

const getCell = (row, columnName) => {
  if (!row || typeof row !== "object") return "";
  if (Object.prototype.hasOwnProperty.call(row, columnName)) {
    return row[columnName];
  }

  const wanted = normalizeText(columnName);
  const matchedKey = Object.keys(row).find(
    (key) => normalizeText(key) === wanted
  );
  return matchedKey ? row[matchedKey] : "";
};

const normalizePhoneNumber = (value) => {
  let text = normalizeText(value);
  if (!text) return "";

  // Excel에서 숫자 셀이 지수 표기로 들어온 경우를 보정합니다.
  if (/^[+-]?\d+(?:\.\d+)?e[+-]?\d+$/i.test(text)) {
    const n = Number(text);
    if (Number.isFinite(n)) text = n.toFixed(0);
  }

  let digits = text.replace(/\D/g, "");
  if (!digits) return "";

  if (digits.startsWith("0082")) {
    digits = `0${digits.slice(4)}`;
  } else if (digits.startsWith("82") && digits.length >= 10) {
    digits = `0${digits.slice(2)}`;
  }

  // Excel 숫자 형식 때문에 맨 앞의 0이 사라진 경우를 가능한 범위에서 복구합니다.
  if (/^1[016789]\d{7,8}$/.test(digits)) {
    digits = `0${digits}`;
  } else if (/^2\d{7,8}$/.test(digits)) {
    digits = `0${digits}`;
  } else if (/^(?:3[1-3]|4[1-4]|5[1-5]|6[1-4]|70)\d{7,8}$/.test(digits)) {
    digits = `0${digits}`;
  }

  return digits;
};

const getPhoneType = (phone) => {
  if (/^01[016789]\d{7,8}$/.test(phone)) return "mobile";

  // 휴대폰이 아닌 국내 0으로 시작하는 9~11자리 번호는 일반전화 범주로 처리합니다.
  if (/^0\d{8,10}$/.test(phone)) return "landline";

  return "";
};

const extractPhoneNumbers = (value) => {
  const text = normalizeText(value);
  if (!text) return [];

  const parts = text
    .split(/[,;/|\n\r]+/)
    .map((part) => normalizePhoneNumber(part))
    .filter(Boolean);

  const phones = parts.length > 0 ? parts : [normalizePhoneNumber(text)];
  return Array.from(new Set(phones.filter((phone) => getPhoneType(phone))));
};

const normalizeAddress = (value) =>
  normalizeText(value)
    .replace(/\s+/g, " ")
    .toLowerCase();

const toFiniteNumber = (value) => {
  const n = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
};

const makeCoordKey = (lat, lng) => {
  const latN = Number(lat);
  const lngN = Number(lng);
  if (!Number.isFinite(latN) || !Number.isFinite(lngN)) return "";
  return `${latN.toFixed(6)},${lngN.toFixed(6)}`;
};

const makeContactRow = (row, rowIndex) => {
  const lat = toFiniteNumber(getCell(row, "lat") || getCell(row, "위도"));
  const lng = toFiniteNumber(getCell(row, "lng") || getCell(row, "경도"));

  return {
    rowIndex,
    meterId: normalizeMeterId(getCell(row, "계기번호")),
    listNo: normalizeText(getCell(row, "리스트번호")),
    address: normalizeAddress(getCell(row, "주소")),
    roadAddress: normalizeAddress(getCell(row, "도로명주소")),
    coordKey: makeCoordKey(lat, lng),
    phones: extractPhoneNumbers(getCell(row, "고객연락처")),
  };
};

const loadContactsForCurrentUser = async (force = false) => {
  let userId = "";
  try {
    userId = normalizeText(localStorage.getItem(USER_ID_STORAGE_KEY));
  } catch (_) {
    return [];
  }

  if (!userId) {
    loadedUserId = "";
    loadedFileName = "";
    contactRows = [];
    return [];
  }

  if (!force && preloadPromise) {
    return preloadPromise;
  }

  if (
    !force &&
    userId === loadedUserId &&
    loadedFileName &&
    Array.isArray(contactRows)
  ) {
    return contactRows;
  }

  preloadPromise = (async () => {
    const { data: userRows, error: userError } = await supabase
      .from("users")
      .select("data_file")
      .eq("id", userId)
      .limit(1);

    if (userError) throw userError;

    const fileName = normalizeText(userRows?.[0]?.data_file);
    if (!fileName || fileName.toUpperCase() === "EMPTY") {
      loadedUserId = userId;
      loadedFileName = "";
      contactRows = [];
      return [];
    }

    if (
      !force &&
      userId === loadedUserId &&
      fileName === loadedFileName &&
      contactRows.length > 0
    ) {
      return contactRows;
    }

    const { data: excelBlob, error: downloadError } = await supabase.storage
      .from("excels")
      .download(fileName);

    if (downloadError) throw downloadError;

    const arrayBuffer = await excelBlob.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: "array" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, {
      defval: "",
      raw: false,
    });

    contactRows = rows
      .map((row, rowIndex) => makeContactRow(row, rowIndex))
      .filter((row) => row.phones.length > 0);
    loadedUserId = userId;
    loadedFileName = fileName;

    return contactRows;
  })()
    .catch(() => {
      contactRows = [];
      return [];
    })
    .finally(() => {
      preloadPromise = null;
    });

  return preloadPromise;
};

const isMarkerPopup = (popup) => {
  if (!(popup instanceof HTMLElement)) return false;

  const buttonTexts = Array.from(popup.children)
    .filter((el) => el.tagName === "BUTTON")
    .map((el) => normalizeText(el.textContent));

  return (
    buttonTexts.includes("가기") &&
    buttonTexts.includes("불가") &&
    buttonTexts.includes("미방문") &&
    (buttonTexts.includes("완료") || buttonTexts.includes("교체"))
  );
};

const getDirectGoButton = (popup) =>
  Array.from(popup.children).find(
    (el) => el.tagName === "BUTTON" && normalizeText(el.textContent) === "가기"
  ) || null;

const getPopupMeterIds = (popup) => {
  const ids = [];

  Array.from(popup.children).forEach((el) => {
    if (el.tagName !== "DIV") return;
    const text = normalizeText(el.textContent);
    if (!text || !text.includes("|")) return;

    const parts = text.split("|").map((part) => normalizeText(part));
    if (parts.length < 4) return;

    const meterId = normalizeMeterId(parts[2]);
    if (meterId) ids.push(meterId);
  });

  return Array.from(new Set(ids));
};

const getPopupListNos = (popup) => {
  const listNos = [];

  Array.from(popup.children).forEach((el) => {
    if (el.tagName !== "DIV") return;
    const text = normalizeText(el.textContent);
    if (!text || text.includes("|") || text.includes(":")) return;

    listNos.push(text);
  });

  return Array.from(new Set(listNos));
};

const getPopupAddress = (popup) => {
  const title = Array.from(popup.children).find((el) => el.tagName === "B");
  if (!title) return "";
  return normalizeAddress(title.textContent);
};

const collectRowsForPopup = (popup, rows) => {
  const popupCoord = popupCoordByElement.get(popup);
  const coordKey = makeCoordKey(popupCoord?.lat, popupCoord?.lng);
  if (coordKey) {
    const matched = rows.filter((row) => row.coordKey && row.coordKey === coordKey);
    if (matched.length > 0) return matched;
  }

  const meterIds = new Set(getPopupMeterIds(popup));
  if (meterIds.size > 0) {
    const matched = rows.filter((row) => meterIds.has(row.meterId));
    if (matched.length > 0) return matched;
  }

  const listNos = new Set(getPopupListNos(popup));
  if (listNos.size > 0) {
    const matched = rows.filter((row) => listNos.has(row.listNo));
    if (matched.length > 0) return matched;
  }

  const address = getPopupAddress(popup);
  if (address) {
    const matched = rows.filter(
      (row) => row.address === address || row.roadAddress === address
    );
    if (matched.length > 0) return matched;
  }

  return [];
};

const pickPreferredPhone = (rows) => {
  const occurrences = [];

  rows.forEach((row) => {
    row.phones.forEach((phone) => {
      const type = getPhoneType(phone);
      if (!type) return;
      occurrences.push({ phone, type, rowIndex: row.rowIndex });
    });
  });

  if (occurrences.length === 0) return "";

  const counts = new Map();
  occurrences.forEach(({ phone }) => {
    counts.set(phone, (counts.get(phone) || 0) + 1);
  });

  const rank = ({ phone, type }) => {
    const duplicated = (counts.get(phone) || 0) > 1;
    if (type === "mobile" && duplicated) return 1;
    if (type === "landline" && duplicated) return 2;
    if (type === "mobile") return 3;
    return 4;
  };

  occurrences.sort((a, b) => {
    const rankDiff = rank(a) - rank(b);
    if (rankDiff !== 0) return rankDiff;
    return a.rowIndex - b.rowIndex;
  });

  return occurrences[0]?.phone || "";
};

const setPhoneButtonState = (button, phone) => {
  button.disabled = false;
  button.dataset.phone = phone || "";
  button.setAttribute(PHONE_BUTTON_READY_ATTR, "1");
  button.title = phone ? `전화 걸기: ${phone}` : "사용 가능한 고객연락처 없음";
  button.style.opacity = phone ? "1" : "0.6";
};

const resolvePhoneForPopup = async (popup, button) => {
  if (popup.getAttribute(POPUP_RESOLVED_ATTR) === "1") return;

  button.disabled = true;
  button.title = "고객연락처 확인 중";
  button.style.opacity = "0.6";

  const rows = await loadContactsForCurrentUser();
  const markerRows = collectRowsForPopup(popup, rows);
  const phone = pickPreferredPhone(markerRows);

  popup.setAttribute(POPUP_RESOLVED_ATTR, "1");
  setPhoneButtonState(button, phone);
};

const injectPhoneButton = (popup) => {
  if (!isMarkerPopup(popup)) return;
  if (popup.querySelector(`[${PHONE_BUTTON_ATTR}="1"]`)) return;

  const goButton = getDirectGoButton(popup);
  if (!goButton) return;

  const phoneButton = document.createElement("button");
  phoneButton.type = "button";
  phoneButton.textContent = "☎";
  phoneButton.setAttribute(PHONE_BUTTON_ATTR, "1");
  phoneButton.style.margin = goButton.style.margin || "4px";
  phoneButton.style.cursor = "pointer";
  phoneButton.setAttribute("aria-label", "고객에게 전화 걸기");

  phoneButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();

    if (phoneButton.getAttribute(PHONE_BUTTON_READY_ATTR) !== "1") {
      alert("고객연락처를 확인 중입니다. 잠시 후 다시 눌러주세요.");
      return;
    }

    const phone = normalizePhoneNumber(phoneButton.dataset.phone);
    if (!phone) {
      alert("이 마커에 사용할 수 있는 고객연락처가 없습니다.");
      return;
    }

    window.location.href = `tel:${phone}`;
  });

  goButton.insertAdjacentElement("afterend", phoneButton);
  resolvePhoneForPopup(popup, phoneButton);
};

const scanForMarkerPopups = (root = document) => {
  const candidates = [];

  if (root instanceof HTMLElement && isMarkerPopup(root)) {
    candidates.push(root);
  }

  if (root?.querySelectorAll) {
    root.querySelectorAll("div").forEach((el) => {
      if (isMarkerPopup(el)) candidates.push(el);
    });
  }

  candidates.forEach(injectPhoneButton);
};

const patchKakaoCustomOverlay = () => {
  const kakaoMaps = window.kakao?.maps;
  const OriginalCustomOverlay = kakaoMaps?.CustomOverlay;

  if (!OriginalCustomOverlay || OriginalCustomOverlay.__amimapPhoneWrapped) {
    return !!OriginalCustomOverlay;
  }

  try {
    function PhoneAwareCustomOverlay(options = {}) {
      const instance = new OriginalCustomOverlay(options);

      try {
        const content = options?.content;
        const position = options?.position;
        if (
          content instanceof HTMLElement &&
          typeof position?.getLat === "function" &&
          typeof position?.getLng === "function"
        ) {
          popupCoordByElement.set(content, {
            lat: Number(position.getLat()),
            lng: Number(position.getLng()),
          });
        }
      } catch (_) {}

      return instance;
    }

    PhoneAwareCustomOverlay.prototype = OriginalCustomOverlay.prototype;
    Object.setPrototypeOf(PhoneAwareCustomOverlay, OriginalCustomOverlay);
    PhoneAwareCustomOverlay.__amimapPhoneWrapped = true;
    kakaoMaps.CustomOverlay = PhoneAwareCustomOverlay;
    return true;
  } catch (_) {
    return false;
  }
};

const startKakaoOverlayPatch = () => {
  if (patchKakaoCustomOverlay()) return;

  kakaoPatchTimer = window.setInterval(() => {
    if (patchKakaoCustomOverlay() && kakaoPatchTimer) {
      window.clearInterval(kakaoPatchTimer);
      kakaoPatchTimer = null;
    }
  }, 200);
};

const startPopupObserver = () => {
  scanForMarkerPopups(document);

  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node instanceof HTMLElement) scanForMarkerPopups(node);
      });
    });
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
};

const startContactPreload = () => {
  const tick = () => {
    let userId = "";
    try {
      userId = normalizeText(localStorage.getItem(USER_ID_STORAGE_KEY));
    } catch (_) {
      userId = "";
    }

    if (userId && userId !== loadedUserId && !preloadPromise) {
      loadContactsForCurrentUser().catch(() => {});
    }
  };

  tick();
  preloadTimer = window.setInterval(tick, 1000);
};

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    () => {
      startKakaoOverlayPatch();
      startPopupObserver();
      startContactPreload();
    },
    { once: true }
  );
} else {
  startKakaoOverlayPatch();
  startPopupObserver();
  startContactPreload();
}

window.addEventListener("beforeunload", () => {
  if (preloadTimer) window.clearInterval(preloadTimer);
  if (kakaoPatchTimer) window.clearInterval(kakaoPatchTimer);
});
