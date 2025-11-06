import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY;
const KAKAO_JS_KEY = import.meta.env.VITE_KAKAO_JAVASCRIPT_KEY;
const KAKAO_REST_KEY = import.meta.env.VITE_KAKAO_REST_API_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function getPostcodeAndCoords(address) {
  const res = await fetch(
    `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(address)}`,
    { headers: { Authorization: `KakaoAK ${KAKAO_REST_KEY}` } }
  );
  const data = await res.json();
  if (data.documents.length === 0) return null;
  const doc = data.documents[0];
  return {
    postcode: doc.address?.zone_no || "00000",
    lat: parseFloat(doc.y),
    lng: parseFloat(doc.x),
  };
}

async function setupTables() {
  await supabase.rpc("execute_sql", {
    sql: `
      create table if not exists users (
        id text primary key,
        password text not null,
        data_file text not null
      );
      create table if not exists meters (
        id serial primary key,
        meter_id text,
        address text,
        postcode text,
        lat float8,
        lng float8,
        status text default '미방문',
        user_id text references users(id)
      );
    `,
  });
}

async function parseExcelFromStorage(user) {
  const { data, error } = await supabase.storage.from("excels").download(user.data_file);
  if (error) throw error;
  const buffer = await data.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet);

  const parsed = [];
  for (const row of rows) {
    const meter_id = row["계기번호"];
    const address = row["주소"];
    const status = row["진행"] || "미방문";
    const geo = await getPostcodeAndCoords(address);
    if (geo) {
      parsed.push({ meter_id, address, postcode: geo.postcode, lat: geo.lat, lng: geo.lng, status, user_id: user.id });
    }
  }
  await supabase.from("meters").delete().eq("user_id", user.id);
  await supabase.from("meters").insert(parsed);
  return parsed;
}

function App() {
  const [user, setUser] = useState(null);
  return user ? <MapPage user={user} /> : <LoginPage onLogin={setUser} />;
}

function LoginPage({ onLogin }) {
  const [id, setId] = useState("");
  const [pw, setPw] = useState("");

  async function login(e) {
    e.preventDefault();
    await setupTables();
    const { data } = await supabase.from("users").select("*").eq("id", id).eq("password", pw).single();
    if (!data) return alert("로그인 실패");
    await parseExcelFromStorage(data);
    onLogin(data);
  }

  return (
    <div className="flex flex-col items-center justify-center h-screen bg-gray-100">
      <h1 className="text-2xl font-bold mb-4">AMIMAPER 로그인</h1>
      <form onSubmit={login} className="bg-white p-6 rounded-lg shadow-md flex flex-col gap-3 w-72">
        <input placeholder="아이디" value={id} onChange={(e) => setId(e.target.value)} className="border p-2 rounded" />
        <input type="password" placeholder="비밀번호" value={pw} onChange={(e) => setPw(e.target.value)} className="border p-2 rounded" />
        <button className="bg-blue-500 text-white py-2 rounded">로그인</button>
      </form>
    </div>
  );
}

function MapPage({ user }) {
  const [map, setMap] = useState(null);
  const [selected, setSelected] = useState(null);
  const [counts, setCounts] = useState({ 완료: 0, 불가: 0, 미방문: 0 });
  const [groups, setGroups] = useState([]);

  async function loadData() {
    const { data } = await supabase.from("meters").select("*").eq("user_id", user.id);
    const grouped = Object.values(data.reduce((acc, cur) => {
      acc[cur.postcode] = acc[cur.postcode] || [];
      acc[cur.postcode].push(cur);
      return acc;
    }, {}));
    setGroups(grouped);
    const cnt = { 완료: 0, 불가: 0, 미방문: 0 };
    data.forEach((d) => (cnt[d.status]++));
    setCounts(cnt);
    renderMarkers(grouped);
  }

  function renderMarkers(grouped) {
    if (!map) return;
    grouped.forEach((g) => {
      const status = g[0].status;
      const color = status === "완료" ? "#00C851" : status === "불가" ? "#ff4444" : "#4285F4";
      const pos = new window.kakao.maps.LatLng(g[0].lat, g[0].lng);
      const content = `<div style="background:${color};color:#fff;border-radius:50%;width:35px;height:35px;line-height:35px;text-align:center;font-weight:bold;">${g.length}</div>`;
      const marker = new window.kakao.maps.CustomOverlay({ position: pos, content });
      marker.setMap(map);
      window.kakao.maps.event.addListener(marker, "click", () => setSelected(g));
    });
  }

  useEffect(() => {
    const script = document.createElement("script");
    script.src = `//dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_JS_KEY}&autoload=false`;
    script.onload = () => {
      window.kakao.maps.load(() => {
        const container = document.getElementById("map");
        const m = new window.kakao.maps.Map(container, {
          center: new window.kakao.maps.LatLng(37.5665, 126.978),
          level: 7,
        });
        setMap(m);
        loadData();
      });
    };
    document.head.appendChild(script);
  }, []);

  return (
    <div className="relative w-full h-screen">
      <div id="map" className="w-full h-full" />
      <div className="absolute top-4 right-4 bg-white rounded-lg p-3 shadow text-sm">
        ✅ 완료: {counts["완료"]} / 🚫 불가: {counts["불가"]} / 🟦 미방문: {counts["미방문"]}
      </div>
      {selected && <Popup group={selected} user={user} setSelected={setSelected} reload={loadData} />}
    </div>
  );
}

function Popup({ group, user, setSelected, reload }) {
  async function updateStatus(status) {
    await supabase.from("meters").update({ status }).eq("postcode", group[0].postcode).eq("user_id", user.id);
    setSelected(null);
    reload();
  }

  return (
    <div className="absolute top-16 left-1/2 -translate-x-1/2 bg-white p-4 rounded-xl shadow-xl w-80 z-50">
      <h3 className="font-bold mb-2">우편번호: {group[0].postcode}</h3>
      <ul className="max-h-40 overflow-y-auto border p-2 text-sm mb-3">
        {group.map((m) => (
          <li key={m.meter_id}>{m.meter_id} — {m.status}</li>
        ))}
      </ul>
      <div className="flex justify-between">
        <button className="bg-green-500 text-white px-3 py-1 rounded" onClick={() => updateStatus("완료")}>완료</button>
        <button className="bg-red-500 text-white px-3 py-1 rounded" onClick={() => updateStatus("불가")}>불가</button>
        <button className="bg-blue-500 text-white px-3 py-1 rounded" onClick={() => updateStatus("미방문")}>미방문</button>
      </div>
      <button className="mt-3 text-gray-500 text-sm" onClick={() => setSelected(null)}>닫기</button>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
