const socket = io();
let map;
let markers = [];
let overlays = [];
let markerData = [];
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

  // 지도 초기화
  markers.forEach(m => m.setMap(null));
  overlays.forEach(o => o.setMap(null));
  markers = [];
  overlays = [];

  // 마커 표시
  markerData.forEach(item => {
    const color =
      item.status === '완료' ? '#2ecc71' :
      item.status === '불가' ? '#e74c3c' :
      '#3498db';

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

    // ✅ 실제 Marker 객체 생성
    const markerImage = new kakao.maps.MarkerImage(
      `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(markerHTML)}`,
      new kakao.maps.Size(36, 36),
      { offset: new kakao.maps.Point(18, 18) }
    );

    const marker = new kakao.maps.Marker({
      position: new kakao.maps.LatLng(item.y, item.x),
      image: markerImage,
      clickable: true
    });
    marker.setMap(map);
    markers.push(marker);

    // ✅ CustomOverlay (정보창)
    const overlayContent = `
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

    const overlay = new kakao.maps.CustomOverlay({
      position: marker.getPosition(),
      content: overlayContent,
      yAnchor: 1
    });
    overlays.push(overlay);

    // ✅ 클릭 이벤트 연결
    kakao.maps.event.addListener(marker, 'click', () => {
      if (activeOverlay) activeOverlay.setMap(null);
      overlay.setMap(map);
      activeOverlay = overlay;
    });
  });

  // 지도 클릭 시 모든 팝업 닫기
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

// ---------------------- 실시간 소켓 반영 ----------------------
socket.on("status_updated", data => {
  markerData.forEach(m => {
    if (m.postal_code === data.postal_code) m.status = data.status;
  });
  updateMap();
});

socket.on("data_updated", () => {
  console.log("🔄 새 데이터 감지됨, 지도 갱신 중...");
  loadData();
});

// ---------------------- 초기 로딩 ----------------------
window.addEventListener("load", () => {
  const container = document.getElementById('map');
  const options = { center: new kakao.maps.LatLng(36.35, 127.38), level: 5 };
  map = new kakao.maps.Map(container, options);
  loadData();
});
