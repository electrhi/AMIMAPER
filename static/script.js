let map;
let markers = [];
let markerData = [];

async function loadData() {
  const res = await fetch('/get_data');
  markerData = await res.json();
  renderMarkers();
}

function renderMarkers() {
  markerData.forEach((item, index) => {
    const position = new naver.maps.LatLng(item.y, item.x);
    const count = item.meters.length;
    const color =
      item.status === "완료" ? "#4caf50" :
      item.status === "불가" ? "#f44336" : "#2196f3";

    const markerHtml = `
      <div style="background:${color}; color:white; border-radius:50%; width:30px; height:30px; display:flex; align-items:center; justify-content:center;">
        ${count}
      </div>`;

    const marker = new naver.maps.Marker({
      position,
      map,
      icon: {
        content: markerHtml,
        anchor: new naver.maps.Point(15, 15),
      },
    });

    const infoHtml = `
      <div style="background:white; padding:10px; border-radius:8px;">
        <b>${item.address}</b><br>
        ${item.meters.map(m => `<div>${m}</div>`).join("")}
        <div style="margin-top:10px;">
          <button class="complete" onclick="updateStatus('${item.postal_code}', '완료')">완료</button>
          <button class="fail" onclick="updateStatus('${item.postal_code}', '불가')">불가</button>
          <button class="pending" onclick="updateStatus('${item.postal_code}', '미방문')">미방문</button>
        </div>
      </div>`;

    const infoWindow = new naver.maps.InfoWindow({ content: infoHtml });
    naver.maps.Event.addListener(marker, "click", () => {
      infoWindow.open(map, marker);
    });

    markers.push(marker);
  });
}

async function updateStatus(postal, status) {
  await fetch('/update_status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ postal_code: postal, status })
  });
  await loadData();
}

function initMap() {
  map = new naver.maps.Map('map', {
    center: new naver.maps.LatLng(36.35, 127.38),
    zoom: 13,
  });
  loadData();
}

window.onload = initMap;
