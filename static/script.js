const socket = io();
let map;
let markers = [];
let markerData = [];

async function loadData() {
  const res = await fetch('/get_data');
  markerData = await res.json();
  updateMap();
}

function updateMap() {
  const statusCount = { 완료: 0, 불가: 0, 미방문: 0 };
  markerData.forEach(d => statusCount[d.status] = (statusCount[d.status] || 0) + 1);

  document.getElementById('doneCount').innerText = statusCount['완료'] || 0;
  document.getElementById('failCount').innerText = statusCount['불가'] || 0;
  document.getElementById('pendingCount').innerText = statusCount['미방문'] || 0;

  markers.forEach(m => m.setMap(null));
  markers = [];

  markerData.forEach(item => {
    let color = item.status === '완료' ? 'green' : item.status === '불가' ? 'red' : 'blue';
    const marker = new naver.maps.Marker({
      position: new naver.maps.LatLng(item.y, item.x),
      map,
      icon: {
        content: `<div style="background:${color};color:white;border-radius:50%;width:28px;height:28px;display:flex;justify-content:center;align-items:center;font-size:13px;">${item.meters.length}</div>`,
        anchor: new naver.maps.Point(14, 14)
      }
    });

    const infoWindow = new naver.maps.InfoWindow({
      content: `<div style="padding:10px;">
          <b>계기번호:</b><br>${item.meters.join("<br>")}
          <hr>
          <div style="text-align:center;">
            <button onclick="changeStatus('${item.postal_code}','완료')">완료</button>
            <button onclick="changeStatus('${item.postal_code}','불가')">불가</button>
            <button onclick="changeStatus('${item.postal_code}','미방문')">미방문</button>
          </div>
        </div>`
    });

    naver.maps.Event.addListener(marker, 'click', () => {
      if (infoWindow.getMap()) infoWindow.close();
      else infoWindow.open(map, marker);
    });

    naver.maps.Event.addListener(map, 'click', () => infoWindow.close());
    markers.push(marker);
  });
}

async function changeStatus(postal, status) {
  await fetch('/update_status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ postal_code: postal, status })
  });
}

socket.on("status_updated", data => {
  markerData.forEach(m => {
    if (m.postal_code === data.postal_code) m.status = data.status;
  });
  updateMap();
});

window.onload = () => {
  map = new naver.maps.Map('map', {
    center: new naver.maps.LatLng(36.351, 127.385),
    zoom: 13
  });
  loadData();
};
