let map;
let markerData = [];
let activePopup = null;
let markers = [];
const socket = io();

// ---------------------- Kakao SDK 로드 완료 후 실행 ----------------------
window.kakaoAsyncInit = function () {
  console.log("✅ Kakao Maps SDK 로드 완료");
  initMap();
};

// ---------------------- Kakao SDK 로드 대기 ----------------------
(function loadKakaoMapScript() {
  const script = document.createElement("script");
  script.src = `//dapi.kakao.com/v2/maps/sdk.js?appkey=${window.kakao_appkey}&autoload=false`;
  script.onload = () => {
    kakao.maps.load(() => {
      console.log("🧭 Kakao Maps API 완전 로드됨");
      initMap();
    });
  };
  document.head.appendChild(script);
})();

// ---------------------- 지도 초기화 ----------------------
function initMap() {
  console.log("🗺️ 지도 초기화 중...");
  const container = document.getElementById("map");
  const options = { center: new kakao.maps.LatLng(36.35, 127.38), level: 5 };
  map = new kakao.maps.Map(container, options);

  kakao.maps.event.addListener(map, "click", closePopup);

  console.log("📡 서버에서 데이터 로드 중...");
  fetch("/get_data", { credentials: "include" })
    .then((res) => res.json())
    .then((data) => {
      markerData = data;
      console.log("✅ 데이터 수신 완료:", data.length, "건");
      updateMap();
    })
    .catch((err) => console.error("❌ 데이터 로드 실패:", err));
}

// ---------------------- 지도 갱신 ----------------------
function updateMap() {
  console.log("🗺️ 지도 갱신 중...");
  if (!map) {
    console.warn("⚠️ map 객체가 아직 준비되지 않음");
    return;
  }

  markers.forEach((m) => m.setMap(null));
  markers = [];

  const statusCount = { 완료: 0, 불가: 0, 미방문: 0 };
  markerData.forEach((d) => (statusCount[d.status] = (statusCount[d.status] || 0) + 1));

  document.getElementById("doneCount").innerText = statusCount["완료"] || 0;
  document.getElementById("failCount").innerText = statusCount["불가"] || 0;
  document.getElementById("pendingCount").innerText = statusCount["미방문"] || 0;

  markerData.forEach((item) => {
    const color =
      item.status === "완료" ? "#2ecc71" :
      item.status === "불가" ? "#e74c3c" : "#3498db";

    const markerHTML = `
      <div style="
        background:${color};
        color:white;
        border-radius:50%;
        width:36px;
        height:36px;
        line-height:36px;
        text-align:center;
        font-weight:bold;
        border:2px solid white;
        box-shadow:0 0 3px rgba(0,0,0,0.3);
        cursor:pointer;
      ">${item.meters.length}</div>
    `;

    const marker = new kakao.maps.CustomOverlay({
      position: new kakao.maps.LatLng(item.y, item.x),
      content: markerHTML,
      map: map
    });

    kakao.maps.event.addListener(marker, "click", () => {
      console.log("📍 마커 클릭:", item.postal_code);
      openPopup(item);
    });

    markers.push(marker);
  });
}

// ---------------------- 팝업 열기 ----------------------
function openPopup(item) {
  closePopup();

  const popup = document.createElement("div");
  popup.className = "popup-overlay";
  popup.innerHTML = `
    <b>계기번호:</b><br>${item.meters.join("<br>")}
    <hr>
    <div style="text-align:center;">
      <button data-status="완료">완료</button>
      <button data-status="불가">불가</button>
      <button data-status="미방문">미방문</button>
    </div>
  `;

  const projection = map.getProjection();
  const point = projection.containerPointFromCoords(new kakao.maps.LatLng(item.y, item.x));

  popup.style.position = "absolute";
  popup.style.left = `${point.x - 100}px`;
  popup.style.top = `${point.y - 120}px`;
  popup.style.background = "white";
  popup.style.border = "1px solid #ccc";
  popup.style.borderRadius = "8px";
  popup.style.padding = "10px";
  popup.style.zIndex = 9999;
  popup.style.pointerEvents = "auto";

  document.body.appendChild(popup);
  activePopup = popup;

  popup.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const newStatus = e.target.dataset.status;
      console.log(`🔘 버튼 클릭됨: ${item.postal_code} → ${newStatus}`);
      await changeStatus(item.postal_code, newStatus);
      closePopup();
    });
  });
}

// ---------------------- 팝업 닫기 ----------------------
function closePopup() {
  if (activePopup) {
    activePopup.remove();
    activePopup = null;
  }
}

// ---------------------- 상태 변경 ----------------------
async function changeStatus(postal, status) {
  console.log(`🔘 상태 변경 요청: ${postal} → ${status}`);
  const res = await fetch("/update_status", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ postal_code: postal, status }),
  });
  console.log("📨 fetch 응답 status:", res.status);

  try {
    const result = await res.json();
    console.log("✅ 서버 응답:", result);
    if (result.message === "ok") {
      markerData.forEach((m) => {
        if (m.postal_code === postal) m.status = status;
      });
      updateMap();
    }
  } catch (e) {
    console.error("❌ 응답 파싱 실패:", e);
  }
}

// ---------------------- 실시간 반영 ----------------------
socket.on("status_updated", (data) => {
  console.log("📬 상태 업데이트 수신:", data);
  markerData.forEach((m) => {
    if (m.postal_code === data.postal_code) m.status = data.status;
  });
  updateMap();
});
