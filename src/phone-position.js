const PHONE_BUTTON_SELECTOR = '[data-amimap-phone-button="1"]';
const BUILDING_LINE_MARKER = "data-amimap-phone-building-line";

const normalizeText = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

const findBuildingLine = (popup) =>
  Array.from(popup?.children || []).find(
    (el) =>
      el.tagName === "DIV" &&
      normalizeText(el.textContent).startsWith("🏢")
  ) || null;

const movePhoneButtonToBuildingLine = (phoneButton) => {
  if (!(phoneButton instanceof HTMLElement)) return;

  // 이미 실제 건물명 줄로 이동한 버튼은 그대로 둡니다.
  // 기존 코드는 팝업 전체 DIV의 textContent에 🏢가 포함되어 있다는 이유로
  // 이동 전에도 "이미 이동됨"으로 잘못 판단할 수 있었습니다.
  if (phoneButton.parentElement?.getAttribute?.(BUILDING_LINE_MARKER) === "1") {
    return;
  }

  const popup = phoneButton.closest("div");
  if (!popup) return;

  const buildingLine = findBuildingLine(popup);
  if (!buildingLine) return;

  buildingLine.setAttribute(BUILDING_LINE_MARKER, "1");

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
