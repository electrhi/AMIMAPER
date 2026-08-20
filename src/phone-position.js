const PHONE_BUTTON_SELECTOR = '[data-amimap-phone-button="1"]';
const BUILDING_LINE_MARKER = "data-amimap-phone-building-line";

const normalizeText = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

const findBuildingLine = (popup) => {
  const children = Array.from(popup?.children || []);

  // 1) 이미 전화 버튼용 건물명 줄로 식별된 경우
  const marked = children.find(
    (el) => el.getAttribute?.(BUILDING_LINE_MARKER) === "1"
  );
  if (marked) return marked;

  // 2) 실제 건물명이 있는 경우: "🏢 건물명"
  const named = children.find(
    (el) =>
      el.tagName === "DIV" &&
      normalizeText(el.textContent).startsWith("🏢")
  );
  if (named) return named;

  // 3) 건물명이 없는 경우에도 main.jsx에는 빈 건물명 DIV가 존재합니다.
  //    이 DIV는 앞뒤가 <br>인 구조이므로 텍스트가 비어 있어도 정확히 찾을 수 있습니다.
  const emptyBuildingLine = children.find(
    (el) =>
      el.tagName === "DIV" &&
      el.previousElementSibling?.tagName === "BR" &&
      el.nextElementSibling?.tagName === "BR"
  );

  return emptyBuildingLine || null;
};

const createBuildingLineIfMissing = (popup) => {
  if (!(popup instanceof HTMLElement)) return null;

  // 예외적으로 건물명 줄 자체가 없는 팝업도 전화 버튼 위치가 동일하도록
  // 구분선(<hr>) 바로 앞에 전용 줄을 만들어 사용합니다.
  const hr = Array.from(popup.children).find((el) => el.tagName === "HR");
  if (!hr) return null;

  const line = document.createElement("div");
  line.style.cssText = "margin-top:4px; color:#444; font-weight:800; min-height:24px; display:flex; align-items:center;";
  popup.insertBefore(line, hr);
  return line;
};

const movePhoneButtonToBuildingLine = (phoneButton) => {
  if (!(phoneButton instanceof HTMLElement)) return;

  // 이미 실제 건물명 줄로 이동한 버튼은 그대로 둡니다.
  if (phoneButton.parentElement?.getAttribute?.(BUILDING_LINE_MARKER) === "1") {
    return;
  }

  const popup = phoneButton.closest("div");
  if (!popup) return;

  const buildingLine = findBuildingLine(popup) || createBuildingLineIfMissing(popup);
  if (!buildingLine) return;

  buildingLine.setAttribute(BUILDING_LINE_MARKER, "1");

  // 건물명이 없더라도 전화 버튼이 동일한 줄/위치에서 보이도록 정렬합니다.
  buildingLine.style.minHeight = buildingLine.style.minHeight || "24px";
  buildingLine.style.display = "flex";
  buildingLine.style.alignItems = "center";

  phoneButton.style.margin = "0 6px 0 0";
  phoneButton.style.padding = "2px 7px";
  phoneButton.style.verticalAlign = "middle";
  phoneButton.style.cursor = "pointer";
  phoneButton.style.flexShrink = "0";

  buildingLine.insertBefore(phoneButton, buildingLine.firstChild);
};

const scan = (root = document) => {
  if (root instanceof HTMLElement && root.matches?.(PHONE_BUTTON_SELECTOR)) {
    movePhoneButtonToBuildingLine(root);
  }

  root?.querySelectorAll?.(PHONE_BUTTON_SELECTOR).forEach((button) => {
    movePhoneButtonToBuildingLine(button);
  });
};

const observer = new MutationObserver(() => {
  scan(document);
});

const start = () => {
  scan(document);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start, { once: true });
} else {
  start();
}
