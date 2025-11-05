const socket = io();
let map;
let markerData = [];
let activePopup = null;

// ---------------------- 지도 초기화 ----------------------
function initMap() {
  console.log("🗺️ 지도 초기화 중...");
  const container = document.getElementById("map");
  const options = { center: new kakao.maps.LatLng(37.5665, 126.9780), level: 5 };
  map = new kakao.maps.Map(container, options);

  loadData();

  kakao.maps.event.addListener(map, "click", () => closePopup());
}

// ---------------------- 데이터 로드 ----------------------
async function loadData() {
  console.log("📡 서버에서 데이터 로드 중...");
  const res = await fetch("/get_data", { credentials: "include" });
  markerData = await res.json();
  console.log("✅ 데이터 수신 완료:", markerData.length, "건");
  updateMap();
}

// ---------------------- 지도 업데이트 ----------------------
function updateMap() {
  console.log("🗺️ 지도 갱신 중...");

  const statusCount = { 완료: 0, 불가: 0, 미방문: 0 };
  markerData.forEach((d) => (statusCount[d.status] = (statusCount[d.status] || 0) + 1));

  document.getElementById("doneCount").innerText = statusCount["완료"] || 0;
  document.getElementById("failCount").innerText = statusCount["불가"] || 0;
  document.getElementById("pendingCount").innerText = statusCount["미방문"] || 0;

  // 모든 마커 제거
  if (window.markers) window.markers.forEach((m) => m.setMap(null));
  window.markers = [];

  markerData.forEach((item) => {
    const color =
      item.status === "완료" ? "#2ecc71" :
      item.status === "불가" ? "#e74c3c" :
      "#3498db";

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
      map: map,
    });

    kakao.maps.event.addListener(marker, "click", () => {
      openPopup(item);
    });

    window.markers.push(marker);
  });
}

// ---------------------- 팝업 열기 ----------------------
function openPopup(item) {
  closePopup();

  console.log("📍 마커 클릭:", item.postal_code);

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

  // 지도 좌표를 화면 좌표로 변환해서 위치 계산
  const projection = map.getProjection();
  const point = projection.containerPointFromCoords(new kakao.maps.LatLng(item.y, item.x));

  popup.style.position = "absolute";
  popup.style.left = `${point.x - 100}px`;
  popup.style.top = `${point.y - 120}px`;
  popup.style.zIndex = 9999;
  popup.style.pointerEvents = "auto";
  popup.style.background = "white";
  popup.style.border = "1px solid #ccc";
  popup.style.borderRadius = "8px";
  popup.style.padding = "10px";

  document.body.appendChild(popup);
  activePopup = popup;

  // 버튼 클릭 이벤트
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
    console.log("✅ 서버 응답 데이터:", result);
    if (result.message === "ok") {
      markerData.forEach((m) => {
        if (m.postal_code === postal) m.status = status;
      });
      updateMap();
    }
  } catch (e) {
    console.error("❌ JSON 파싱 실패:", e);
  }
}

// ---------------------- 소켓 수신 ----------------------
socket.on("status_updated", (data) => {
  console.log("📬 상태 업데이트 수신:", data);
  markerData.forEach((m) => {
    if (m.postal_code === data.postal_code) m.status = data.status;
  });
  updateMap();
});
