// 임의 마커 편집창 UI 보강
// - 하단 '닫기' 버튼을 '가기'로 변경
// - 제목 오른쪽 X 버튼으로 편집창 닫기
// - '가기'는 기존 앱과 동일한 카카오 길찾기 방식 사용
(() => {
  let kakaoEventPatched = false;

  const startNavigation = (destLabel, destLat, destLng) => {
    if (!Number.isFinite(destLat) || !Number.isFinite(destLng)) {
      alert("목적지 좌표가 올바르지 않습니다.");
      return;
    }

    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || "");

    const openFallback = () => {
      const fallbackUrl = isMobile
        ? `https://m.map.kakao.com/scheme/look?p=${destLat},${destLng}`
        : `https://map.kakao.com/link/to/${encodeURIComponent(destLabel)},${destLat},${destLng}`;
      window.location.href = fallbackUrl;
    };

    if (!navigator.geolocation) {
      openFallback();
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const curLat = Number(pos.coords.latitude);
        const curLng = Number(pos.coords.longitude);

        if (!Number.isFinite(curLat) || !Number.isFinite(curLng)) {
          openFallback();
          return;
        }

        if (isMobile) {
          window.location.href =
            `https://m.map.kakao.com/scheme/route?sp=${curLat},${curLng}` +
            `&ep=${destLat},${destLng}&by=car`;
          return;
        }

        const pcRouteUrl =
          `https://map.kakao.com/link/from/${encodeURIComponent("현재위치")},${curLat},${curLng}` +
          `/to/${encodeURIComponent(destLabel)},${destLat},${destLng}`;
        window.open(pcRouteUrl, "_blank", "noopener,noreferrer");
      },
      () => openFallback(),
      {
        enableHighAccuracy: true,
        timeout: 5000,
        maximumAge: 10000,
      }
    );
  };

  const patchKakaoEventApi = () => {
    if (kakaoEventPatched) return true;

    const eventApi = window.kakao?.maps?.event;
    if (!eventApi?.addListener) return false;

    const originalAddListener = eventApi.addListener.bind(eventApi);

    eventApi.addListener = (target, type, handler) => {
      if (
        type === "click" &&
        typeof handler === "function" &&
        typeof target?.getPosition === "function" &&
        typeof target?.setDraggable === "function"
      ) {
        const wrappedHandler = (...args) => {
          window.__amimapLastClickedKakaoMarker = target;
          return handler(...args);
        };
        return originalAddListener(target, type, wrappedHandler);
      }

      return originalAddListener(target, type, handler);
    };

    kakaoEventPatched = true;
    return true;
  };

  // Kakao SDK는 로그인 후 동적으로 추가되므로 로드 시점을 놓치지 않도록 감시한다.
  const patchTimer = window.setInterval(() => {
    if (patchKakaoEventApi()) window.clearInterval(patchTimer);
  }, 25);

  const findCustomEditorTitle = (root) => {
    const candidates = [];
    if (root?.nodeType === Node.ELEMENT_NODE) candidates.push(root);
    if (root?.querySelectorAll) candidates.push(...root.querySelectorAll("div"));

    return candidates.find(
      (el) =>
        el.tagName === "DIV" &&
        String(el.textContent || "").trim() === "임의 마커 편집"
    );
  };

  const enhanceEditor = (title) => {
    const box = title?.parentElement;
    if (!box || box.dataset.amimapCustomEditorEnhanced === "1") return;

    const buttons = Array.from(box.querySelectorAll("button"));
    const originalCloseBtn = buttons.find(
      (btn) => String(btn.textContent || "").trim() === "닫기"
    );
    if (!originalCloseBtn || typeof originalCloseBtn.onclick !== "function") return;

    const marker = window.__amimapLastClickedKakaoMarker;
    if (!marker || typeof marker.getPosition !== "function") return;

    box.dataset.amimapCustomEditorEnhanced = "1";

    // 기존 닫기 동작을 보존해 X 버튼과 '가기' 실행 직전에 재사용한다.
    const originalCloseHandler = originalCloseBtn.onclick;
    const closeEditor = (event) => {
      try {
        originalCloseHandler.call(originalCloseBtn, event);
      } catch (_) {
        try { marker.setDraggable(false); } catch (_) {}
      }
    };

    // 제목 줄 오른쪽에 X 버튼 배치
    const titleText = document.createElement("span");
    titleText.textContent = "임의 마커 편집";

    const xBtn = document.createElement("button");
    xBtn.type = "button";
    xBtn.textContent = "✕";
    xBtn.setAttribute("aria-label", "임의 마커 편집 닫기");
    xBtn.style.cssText = `
      border:none;
      background:transparent;
      color:#555;
      font-size:18px;
      line-height:1;
      padding:2px 4px;
      margin:0;
      cursor:pointer;
      font-weight:800;
      flex:0 0 auto;
    `;
    xBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      closeEditor(event);
    });

    title.textContent = "";
    title.style.cssText = `
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap:8px;
      font-weight:800;
      margin-bottom:8px;
    `;
    title.appendChild(titleText);
    title.appendChild(xBtn);

    // 하단 '닫기'를 '가기'로 전환
    originalCloseBtn.textContent = "가기";
    originalCloseBtn.setAttribute("aria-label", "이 임의 마커로 길찾기");
    originalCloseBtn.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();

      const pos = marker.getPosition?.();
      const destLat = Number(pos?.getLat?.());
      const destLng = Number(pos?.getLng?.());
      const input = box.querySelector('input[type="text"]');
      const destLabel = String(input?.value || "임의 마커").trim() || "임의 마커";

      closeEditor(event);
      startNavigation(destLabel, destLat, destLng);
    };
  };

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes || []) {
        const title = findCustomEditorTitle(node);
        if (title) enhanceEditor(title);
      }
    }
  });

  const startObserver = () => {
    if (!document.body) {
      window.setTimeout(startObserver, 0);
      return;
    }
    observer.observe(document.body, { childList: true, subtree: true });
  };

  startObserver();
})();
