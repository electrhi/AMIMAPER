let map;
let markerData = [];
let markers = [];
let activePopup = null;
const socket = io();

// ---------------------- 지도 초기화 ----------------------
function initMap() {
  console.log("🗺️ 지도 초기화 중...");
  map = new kakao.maps.Map(document.getElementById("map"), {
    center: new kakao.maps.LatLng(37.5665, 126.9780),
    level: 5
  });

  kakao.maps.event.addListener(map, "click", () => closePopup());

  loadData();
}

// ---------------------- 데이터 불러오기 ----------------------
async function loadData() {
  console.log("📡 서버에서 데이터 로드 중...");
  try {
    const res = await fetch("/get_data", { credentials: "include" });
    const data = await res.json();
    console.log("✅ 데이터 수신 완료:", data.length, "건");
    markerData = data;
    renderMarkers();
  } catch (e) {
    console.error("❌ 데이터 불러오기 실패:", e);
  }
}

// ---------------------- 마커 렌더링 ----------------------
function renderMarkers() {
  console.log("🗺️ 지도 마커 렌더링 중...");

  markers.forEach((m) => m.setMap(null));
  markers = [];

  const statusCount = { 완료: 0, 불가: 0, 미방문: 0 };

  markerData.forEach((d) => (statusCount[d.status] = (statusCount[d.status] || 0) + 1));

  document.getElementById("doneCount").innerText = statusCount["완료"] || 0;
  document.getElementById("failCount").innerText = statusCount["불가"] || 0;
  document.getElementById("pendingCount").innerText = statusCount["미방문"] || 0;

  markerData.forEach((item) => {
    const color =
      item.status === "완료"
        ? "#2ecc71"
        : item.status === "불가"
        ? "#e74c3c"
        : "#3498db";

    const marker = new kakao.maps.Marker({
      map: map,
      position: new kakao.maps.LatLng(item.y, item.x),
      title: item.postal_code
    });

    const markerEl = document.createElement("div");
    markerEl.innerHTML = `
      <div style="
        background:${color};
        width:30px;height:30px;
        border-radius:50%;
        border:2px solid white;
        box-shadow:0 0 3px rgba(0,0,0,0.3);
        text-align:center;
        line-height:30px;
        color:white;font-weight:bold;
        cursor:pointer;
      ">${item.meters.length}</div>
    `;
    marker.setContent = markerEl;
    markerEl.addEventListener("click", () => {
      console.log("📍 마커 클릭:", item.postal_code);
      openPopup(item);
    });

    markers.push(marker);
  });
}

// ---------------------- 팝업 열기 ----------------------
function openPopup(item) {
  closePopup();

  const projection = map.getProjection();
  const point = projection.containerPointFromCoords(new kakao.maps.LatLng(item.y, item.x));

  const popup = document.createElement("div");
  popup.className = "map-popup";
  popup.innerHTML = `
    <div style="padding:10px;background:white;border-radius:8px;border:1px solid #ccc;box-shadow:0 2px 6px rgba(0,0,0,0.3);">
      <b>계기번호:</b><br>${item.meters.join("<br>")}
      <hr>
      <div style="text-align:center;">
        <button data-status="완료">완료</button>
        <button data-status="불가">불가</button>
        <button data-status="미방문">미방문</button>
      </div>
    </div>
  `;
  popup.style.position = "absolute";
  popup.style.left = `${point.x - 80}px`;
  popup.style.top = `${point.y - 120}px`;
  popup.style.zIndex = 9999;

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
  console.log("📨 fetch 응답:", res.status);
  const result = await res.json();
  console.log("✅ 서버 응답:", result);

  if (result.message === "ok") {
    markerData.forEach((m) => {
      if (m.postal_code === postal) m.status = status;
    });
    renderMarkers();
  }
}

// ---------------------- 실시간 반영 ----------------------
socket.on("status_updated", (data) => {
  console.log("📬 상태 업데이트 수신:", data);
  markerData.forEach((m) => {
    if (m.postal_code === data.postal_code) m.status = data.status;
  });
  renderMarkers();
});
