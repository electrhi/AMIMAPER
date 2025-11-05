const socket = io();
let map;
let markerData = [];
let overlays = [];
let activeOverlay = null;

// ---------------------- 데이터 로드 ----------------------
async function loadData() {
  const res = await fetch('/get_data');
  markerData = await res.json();
  updateMap();
}

// ---------------------- 지도 업데이트 ----------------------
function updateMap() {
  // 상태 카운트 계산
  const statusCount = { 완료: 0, 불가: 0, 미방문: 0 };
  markerData.forEach(d => {
    statusCount[d.status] = (statusCount[d.status] || 0) + 1;
  });

  document.getElementById('doneCount').innerText = statusCount['완료'] || 0;
  document.getElementById('failCount').innerText = statusCount['불가'] || 0;
  document.getElementById('pendingCount').innerText = statusCount['미방문'] || 0;

  // 기존 마커 삭제
  overlays.forEach(o => o.setMap(null));
  overlays = [];

  // 새 마커 표시
  markerData.forEach(item => {
    const color =
      item.status === '완료' ? '#2ecc71' :
      item.status === '불가' ? '#e74c3c' :
      '#3498db';

    // ✅ 원형 마커
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

// ---------------------- 마커 클릭 시 팝업 표시 ----------------------
function onMarkerClick(postal) {
  if (activeOverlay) activeOverlay.setMap(null);

  const target = markerData.find(m => m.postal_code === postal);
  if (!target) return;

  const overlayHTML = `
    <div style="padding:10px; background:white; border:1px solid #ccc; border-radius:8px; width:200px;">
      <b>계기번호:</b><br>${target.meters.join("<br>")}
      <hr>
      <div style="text-align:center;">
        <button onclick="changeStatus('${postal}','완료')">완료</button>
        <button onclick="changeStatus('${postal}','불가')">불가</button>
        <button onclick="changeStatus('${postal}','미방문')">미방문</button>
      </div>
    </div>
  `;

  const popup = new kakao.maps.CustomOverlay({
    position: new kakao.maps.LatLng(target.y, target.x),
    content: overlayHTML,
    yAnchor: 1
  });

  popup.setMap(map);
  activeOverlay = popup;
}

// ---------------------- 상태 변경 ----------------------
async function changeStatus(postal, status) {
  await fetch('/update_status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ postal_code: postal, status })
  });
}

// ---------------------- 소켓 이벤트 ----------------------
socket.on("status_updated", data => {
  // 동일 우편번호 모두 상태 변경
  markerData.forEach(m => {
    if (m.postal_code === data.postal_code) {
      m.status = data.status;
    }
  });
  updateMap();
});

socket.on("data_updated", () => {
  console.log("🔄 새 데이터 감지됨, 지도 새로고침 중...");
  loadData();
});

// ---------------------- 지도 클릭 시 팝업 닫기 ----------------------
function addMapClickListener() {
  kakao.maps.event.addListener(map, 'click', () => {
    if (activeOverlay) activeOverlay.setMap(null);
  });
}

// ---------------------- 초기 로딩 ----------------------
window.addEventListener("load", () => {
  const container = document.getElementById('map');
  const options = { center: new kakao.maps.LatLng(37.5665, 126.9780), level: 5 };
  map = new kakao.maps.Map(container, options);
  addMapClickListener();
  loadData();
});
