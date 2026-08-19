const PHONE_BUTTON_SELECTOR = '[data-amimap-phone-button="1"]';

const normalizeText = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

const findBuildingLine = (popup) =>
  Array.from(popup?.children || []).find(
    (el) =>
      el.tagName === "DIV" &&
      normalizeText(el.textContent).startsWith("🏢")
  ) || null;

const movePhoneButtonToBuildingLine = (phoneButton) => {
  if (!(phoneButton instanceof HTMLElement)) return;

  const popup = phoneButton.closest("div");
  if (!popup) return;

  // 전화 버튼이 이미 건물명 줄 안에 있으면 더 이상 이동하지 않습니다.
  if (
    phoneButton.parentElement?.tagName === "DIV" &&
    normalizeText(phoneButton.parentElement.textContent).includes("🏢")
  ) {
    return;
  }

  const buildingLine = findBuildingLine(popup);
  if (!buildingLine) return;

  phoneButton.style.margin = "0 6px 0 0";
  phoneButton.style.padding = "2px 7px";
  phoneButton.style.verticalAlign = "middle";
  phoneButton.style.cursor = "pointer";

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
