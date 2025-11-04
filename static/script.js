const socket = io();
let map;
let markers = [];
let markerData = [];


// ✅ Kakao SDK Debug Helper
(function() {
  console.log("🧭 [Kakao SDK Debug] Checking environment...");

  // 1. SDK 스크립트 태그가 존재하는지 확인
  const kakaoScript = Array.from(document.getElementsByTagName("script"))
    .find(s => s.src.includes("dapi.kakao.com/v2/maps/sdk.js"));

  if (!kakaoScript) {
    console.error("❌ Kakao Maps SDK script not found in HTML.");
    console.info("👉 index.html에 다음 코드가 있는지 확인하세요:");
    console.info('<script src="https://dapi.kakao.com/v2/maps/sdk.js?appkey=YOUR_KEY"></script>');
    return;
  }

  // 2. appkey 값이 들어가 있는지 확인
  const appkeyMatch = kakaoScript.src.match(/appkey=([^&]+)/);
  if (!appkeyMatch || !appkeyMatch[1]) {
    console.error("❌ Kakao Maps SDK appkey missing or empty.");
    console.info("👉 Flask에서 {{ kakao_api_key }} 값이 전달되지 않았을 가능성이 높습니다.");
    console.info("환경변수 KAKAO_API_KEY가 올바른지, Render 환경변수 설정을 확인하세요.");
    return;
  }

  console.log(`✅ Found SDK script tag with appkey: ${appkeyMatch[1]}`);

  // 3. SDK 객체 로드 확인
  setTimeout(() => {
    if (typeof kakao === "undefined") {
      console.error("❌ Kakao SDK not loaded in window.");
      console.info("👉 가능한 원인:");
      console.info("1️⃣ 카카오 개발자센터에서 도메인 등록이 안 되어 있음");
      console.info("2️⃣ appkey 오타 (JavaScript 키인지 확인)");
      console.info("3️⃣ http:// 대신 https:// 필요");
      console.info("4️⃣ 네트워크 차단 또는 CSP 정책");
    } else {
      console.log("✅ Kakao SDK successfully loaded!");
      console.log("🗺️ Kakao Maps version check:", kakao.maps ? "OK" : "maps module missing");
    }
  }, 1000);
})();


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
window.addEventListener("load", () => {
  if (typeof kakao === "undefined") {
    console.error("⚠️ Kakao SDK not loaded. Check your appkey or domain settings.");
    return;
  }

  const container = document.getElementById('map');
  const options = {
    center: new kakao.maps.LatLng(36.351, 127.385),
    level: 5
  };
  map = new kakao.maps.Map(container, options);
  loadData();
});


