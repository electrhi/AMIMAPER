const socket = io();
let map;
let markerData = [];
let markerOverlays = [];
let activeOverlay = null;

// ---------------------- 데이터 로드 ----------------------
async function loadData() {
  const res = await fetch('/get_data');
  markerData = await res.json();
  updateMap();
}

// ---------------------- 지도 업데이트 ----------------------
function updateMap() {
  const statusCount = { 완료: 0, 불가: 0, 미방문: 0 };
  markerData.forEach(d => statusCount[d.status] = (statusCount[d.status] || 0) + 1);

  document.getElementById('doneCount').innerText = statusCount['완료'] || 0;
  document.getElementById('failCount').innerText = statusCount['불가'] || 0;
  document.getElementById('pendingCount').innerText = statusCount['미방문'] || 0;

  markerOverlays.forEach(o => o.setMap(null));
  markerOverlays = [];

  markerData.forEach(item => {
    const color =
      item.status === '완료' ? '#2ecc71' :
      item.status === '불가' ? '#e74c3c' :
      '#3498db';

    // ✅ 마커 모양 (HTML)
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
      ">${item.meters.length}</div>
    `;

    const markerOverlay = new kakao.maps.CustomOverlay({
      position: new kakao.maps.LatLng(item.y, item.x),
      content: markerHTML,
      map: map
    });

    // ✅ 팝업 (CustomOverlay)
    const popupHTML = `
      <div style="padding:10px; background:white; border:1px solid #ccc; border-radius:8px; width:200px;">
        <b>계기번호:</b><br>${item.meters.join("<br>")}
        <hr>
        <div style="text-align:center;">
          <button onclick="changeStatus('${item.postal_code}','완료')">완료</button>
          <button onclick="changeStatus('${item.postal_code}','불가')">불가</button>
          <button onclick="changeStatus('${item.postal_code}','미방문')">미방문</button>
        </div>
      </div>
    `;

    const popupOverlay = new kakao.maps.CustomOverlay({
      position: markerOverlay.getPosition(),
      content: popupHTML,
      yAnchor: 1
    });

    // ✅ 투명 클릭용 Marker 추가 (이벤트 감지 전용)
    const clickMarker = new kakao.maps.Marker({
      position: markerOverlay.getPosition(),
      clickable: true,
      opacity: 0
    });
    clickMarker.setMap(map);

    kakao.maps.event.addListener(clickMarker, 'click', () => {
      if (activeOverlay) activeOverlay.setMap(null);
      popupOverlay.setMap(map);
      activeOverlay = popupOverlay;
    });

    markerOverlays.push(markerOverlay);
  });

  // 지도 클릭 시 팝업 닫기
  kakao.maps.event.addListener(map, 'click', () => {
    if (activeOverlay) activeOverlay.setMap(null);
  });
}

// ---------------------- 상태 변경 ----------------------
async function changeStatus(postal, status) {
  await fetch('/update_status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ postal_code: postal, status })
  });
}

// ---------------------- 소켓 반영 ----------------------
socket.on("status_updated", data => {
  // 동일 우편번호 모두 갱신
  markerData.forEach(m => {
    if (m.postal_code === data.postal_code) m.status = data.status;
  });
  updateMap();
});

socket.on("data_updated", () => {
  console.log("🔄 새 데이터 감지됨, 지도 갱신 중...");
  loadData();
});

// ---------------------- 초기화 ----------------------
window.addEventListener("load", () => {
  const container = document.getElementById('map');
  const options = { center: new kakao.maps.LatLng(36.35, 127.38), level: 5 };
  map = new kakao.maps.Map(container, options);
  loadData();
});
