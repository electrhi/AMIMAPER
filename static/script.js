const socket = io();
let map, infowindow, markers = [];

window.onload = async () => {
  const mapOptions = { center: new naver.maps.LatLng(36.35, 127.38), zoom: 11 };
  map = new naver.maps.Map("map", mapOptions);
  infowindow = new naver.maps.InfoWindow({ disableAnchor: true });

  const res = await fetch("/get_data");
  const data = await res.json();

  data.forEach((loc) => {
    const count = loc.meter.split(",").length;
    const colorClass =
      loc.status === "완료"
        ? "marker-done"
        : loc.status === "불가"
        ? "marker-fail"
        : "marker-pending";

    const marker = new naver.maps.Marker({
      position: new naver.maps.LatLng(loc.y, loc.x),
      map,
      icon: {
        content: `<div class="marker ${colorClass}"><span>1</span></div>`,
        anchor: new naver.maps.Point(15, 15),
      },
    });

    marker.postal_code = loc.postal_code;
    marker.status = loc.status;

    naver.maps.Event.addListener(marker, "click", () => {
      const html = `
        <div class="info-popup">
          <h4>${loc.address}</h4>
          <div class="btn-group">
            <button class="btn-done">완료</button>
            <button class="btn-fail">불가</button>
            <button class="btn-pending">미방문</button>
          </div>
        </div>`;
      infowindow.setContent(html);
      infowindow.open(map, marker);
      setTimeout(() => attachButtonEvents(marker), 100);
    });

    markers.push(marker);
  });

  socket.on("status_updated", (data) => {
    const marker = markers.find((m) => m.postal_code === data.postal_code);
    if (marker) changeMarkerStatus(marker, data.status, false);
  });
};

function attachButtonEvents(marker) {
  document.querySelector(".btn-done")?.addEventListener("click", () => {
    changeMarkerStatus(marker, "완료", true);
  });
  document.querySelector(".btn-fail")?.addEventListener("click", () => {
    changeMarkerStatus(marker, "불가", true);
  });
  document.querySelector(".btn-pending")?.addEventListener("click", () => {
    changeMarkerStatus(marker, "미방문", true);
  });
}

function changeMarkerStatus(marker, newStatus, notifyServer) {
  const colorClass =
    newStatus === "완료"
      ? "marker-done"
      : newStatus === "불가"
      ? "marker-fail"
      : "marker-pending";

  marker.setIcon({
    content: `<div class="marker ${colorClass}"><span>1</span></div>`,
    anchor: new naver.maps.Point(15, 15),
  });

  if (notifyServer) {
    fetch("/update_status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        postal_code: marker.postal_code,
        status: newStatus,
      }),
    });
  }
}
