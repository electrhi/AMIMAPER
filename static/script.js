const socket = io();
let map;
let markers = [];
let markerData = [];

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

  markers.forEach(m => m.setMap(null));
  markers = [];

  markerData.forEach(item => {
    let color = item.status === '완료' ? '#2ecc71' :
                item.status === '불가' ? '#e74c3c' : '#3498db';

    // ✅ Kakao Marker
    const marker = new kakao.maps.Marker({
      position: new kakao.maps.LatLng(item.y, item.x),
      map: map
    });

    // ✅ Custom Overlay (정보창)
    const overlayContent = `
      <div style="padding:10px; background:white; border:1px solid #ccc; border-radius:8px; width:180px;">
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

    kakao.maps.event.addListener(marker, 'click', () => {
      overlay.setMap(overlay.getMap() ? null : map);
    });

    markers.push(marker);
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

// ---------------------- 초기 로딩 ----------------------
window.onload = () => {
  const container = document.getElementById('map');
  const options = {
    center: new kakao.maps.LatLng(36.351, 127.385),
    level: 5
  };
  map = new kakao.maps.Map(container, options);
  loadData();
};
