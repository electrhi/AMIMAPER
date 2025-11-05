const socket = io();
let map;
let markerData = [];
let overlays = [];
let activeOverlay = null;

// ---------------------- 지도 초기화 ----------------------
function initMap() {
  console.log("🗺️ 지도 초기화 중...");
  const container = document.getElementById('map');
  const options = { center: new kakao.maps.LatLng(37.5665, 126.9780), level: 5 };
  map = new kakao.maps.Map(container, options);

  addMapClickListener();
  loadData();
}

// ---------------------- 데이터 로드 ----------------------
async function loadData() {
  console.log("📡 서버에서 데이터 로드 중...");
  const res = await fetch('/get_data', { credentials: 'include' });
  markerData = await res.json();
  console.log("✅ 데이터 수신 완료:", markerData.length, "건");
  updateMap();
}

// ---------------------- 지도 업데이트 ----------------------
function updateMap() {
  console.log("🗺️ 지도 갱신 중...");

  const statusCount = { 완료: 0, 불가: 0, 미방문: 0 };
  markerData.forEach(d => statusCount[d.status] = (statusCount[d.status] || 0) + 1);

  document.getElementById('doneCount').innerText = statusCount['완료'] || 0;
  document.getElementById('failCount').innerText = statusCount['불가'] || 0;
  document.getElementById('pendingCount').innerText = statusCount['미방문'] || 0;

  overlays.forEach(o => o.setMap(null));
  overlays = [];

  markerData.forEach(item => {
    const color =
      item.status === '완료' ? '#2ecc71' :
      item.status === '불가' ? '#e74c3c' :
      '#3498db';

    const markerHTML = `
      <div onclick="onMarkerClick('${item.postal_code}')"
        style="
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
        ">
        ${item.meters.length}
      </div>
    `;

    const markerOverlay = new kakao.maps.CustomOverlay({
      position: new kakao.maps.LatLng(item.y, item.x),
      content: markerHTML,
      map: map
    });

    overlays.push(markerOverlay);
  });
}

// ---------------------- 마커 클릭 ----------------------
function onMarkerClick(postal) {
  console.log("📍 마커 클릭:", postal);
  if (activeOverlay) activeOverlay.setMap(null);

  const target = markerData.find(m => m.postal_code === postal);
  if (!target) return;

  const overlayHTML = document.createElement('div');
  overlayHTML.innerHTML = `
    <div class="popup-overlay">
      <b>계기번호:</b><br>${target.meters.join("<br>")}
      <hr>
      <div style="text-align:center;">
        <button class="status-btn" data-postal="${postal}" data-status="완료">완료</button>
        <button class="status-btn" data-postal="${postal}" data-status="불가">불가</button>
        <button class="status-btn" data-postal="${postal}" data-status="미방문">미방문</button>
      </div>
    </div>
  `;

  overlayHTML.querySelectorAll(".status-btn").forEach(btn => {
    btn.addEventListener("click", async e => {
      e.stopPropagation();
      const p = e.target.dataset.postal;
      const s = e.target.dataset.status;
      console.log(`🔘 상태 변경 클릭됨: ${p} → ${s}`);
      await changeStatus(p, s);
    });
  });

  const popup = new kakao.maps.CustomOverlay({
    position: new kakao.maps.LatLng(target.y, target.x),
    content: overlayHTML,
    yAnchor: 1,
    zIndex: 9999
  });

  popup.setMap(map);
  activeOverlay = popup;
}

// ---------------------- 상태 변경 ----------------------
async function changeStatus(postal, status) {
  console.log(`🔘 상태 변경 요청: ${postal} → ${status}`);
  const res = await fetch('/update_status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ postal_code: postal, status })
  });

  const result = await res.json();
  console.log("✅ 서버 응답:", result);

  if (result.message === "ok") {
    markerData.forEach(m => {
      if (m.postal_code === postal) m.status = status;
    });
    updateMap();
  } else {
    console.warn("⚠️ 업데이트 실패:", result);
  }
}

// ---------------------- 소켓 이벤트 ----------------------
socket.on("status_updated", data => {
  console.log("📬 상태 업데이트 수신:", data);
  markerData.forEach(m => {
    if (m.postal_code === data.postal_code) m.status = data.status;
  });
  updateMap();
});

function addMapClickListener() {
  kakao.maps.event.addListener(map, 'click', () => {
    if (activeOverlay) activeOverlay.setMap(null);
  });
}
