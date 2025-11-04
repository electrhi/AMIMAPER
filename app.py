# =============================
# app.py (전체 교체본)
# =============================

import eventlet
eventlet.monkey_patch()

from flask import Flask, render_template, request, jsonify, session, redirect, url_for
from flask_socketio import SocketIO, emit
from supabase import create_client, Client
import requests, json, urllib.parse, os

# -----------------------------
# Flask 초기화
# -----------------------------
app = Flask(__name__)
app.secret_key = "super_secret_key"
socketio = SocketIO(app, cors_allowed_origins="*")

# -----------------------------
# 환경 변수 불러오기 (.env 또는 서버 환경 변수)
# -----------------------------
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
NAVER_CLIENT_ID = os.getenv("NAVER_CLIENT_ID")
NAVER_CLIENT_SECRET = os.getenv("NAVER_CLIENT_SECRET")

# Supabase 초기화
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# -------------------------------------------------------------------------
# 로그인 페이지
# -------------------------------------------------------------------------
@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        username = request.form["username"]
        password = request.form["password"]

        users = supabase.table("users").select("*").eq("username", username).execute().data

        if users and users[0]["password"] == password:
            session["user"] = username
            session["dataset"] = users[0]["dataset"]
            return redirect(url_for("index"))
        else:
            return render_template("login.html", error="❌ 아이디 또는 비밀번호가 올바르지 않습니다.")

    return render_template("login.html")


# -------------------------------------------------------------------------
# 지도 메인 페이지
# -------------------------------------------------------------------------
@app.route("/")
def index():
    if "user" not in session:
        return redirect(url_for("login"))
    # ✅ naver_client_id를 index.html에 전달
    return render_template(
        "index.html",
        user=session["user"],
        naver_client_id=NAVER_CLIENT_ID
    )


# -------------------------------------------------------------------------
# Supabase에서 데이터 불러오기
# -------------------------------------------------------------------------
@app.route("/get_data")
def get_data():
    if "dataset" not in session:
        return jsonify([])

    dataset = session["dataset"]
    rows = supabase.table("field_data").select("*").eq("dataset", dataset).execute().data

    results = []
    for item in rows:
        address = item.get("address")
        postal_code = item.get("postal_code")
        status = item.get("status", "미방문")
        x, y = item.get("x"), item.get("y")

        # ✅ meters 처리 (쉼표 또는 JSON 자동 변환)
        raw_meters = item.get("meters")
        meters = []
        if isinstance(raw_meters, str):
            try:
                if raw_meters.startswith("["):
                    meters = json.loads(raw_meters)
                else:
                    meters = [m.strip() for m in raw_meters.split(",") if m.strip()]
            except Exception:
                meters = [raw_meters]
        elif isinstance(raw_meters, list):
            meters = raw_meters
        else:
            meters = []

        # ✅ 좌표가 없는 경우, 네이버 지오코딩 호출
        if not x or not y:
            encoded = urllib.parse.quote(address)
            # ✅ 변경된 외부 접근 가능한 엔드포인트 사용
            url = f"https://naveropenapi.apigw.ntruss.com/map-geocode/v2/geocode?query={encoded}"
            headers = {
                "x-ncp-apigw-api-key-id": NAVER_CLIENT_ID,
                "x-ncp-apigw-api-key": NAVER_CLIENT_SECRET,
                "Accept": "application/json"
            }
            res = requests.get(url, headers=headers)

            if res.status_code == 200:
                data = res.json()
                if data.get("addresses"):
                    addr = data["addresses"][0]
                    x, y = float(addr["x"]), float(addr["y"])
                    postal_code = next(
                        (e["longName"] for e in addr["addressElements"] if "POSTAL_CODE" in e["types"]),
                        None
                    )
                    # Supabase 업데이트
                    supabase.table("field_data").update({
                        "x": x,
                        "y": y,
                        "postal_code": postal_code
                    }).eq("id", item["id"]).execute()

        results.append({
            "id": item["id"],
            "dataset": dataset,
            "postal_code": postal_code,
            "address": address,
            "meters": meters,
            "x": x,
            "y": y,
            "status": status
        })

    return jsonify(results)


# -------------------------------------------------------------------------
# 마커 상태 업데이트
# -------------------------------------------------------------------------
@app.route("/update_status", methods=["POST"])
def update_status():
    data = request.json
    dataset = session.get("dataset")
    postal_code = data["postal_code"]
    new_status = data["status"]

    # ✅ 동일 우편번호 전체 변경
    supabase.table("field_data").update({"status": new_status}) \
        .eq("dataset", dataset).eq("postal_code", postal_code).execute()

    socketio.emit("status_updated", {
        "postal_code": postal_code,
        "status": new_status
    }, broadcast=True)

    return jsonify({"message": "ok"})


# -------------------------------------------------------------------------
# 로그아웃
# -------------------------------------------------------------------------
@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


# -------------------------------------------------------------------------
# 서버 시작
# -------------------------------------------------------------------------
if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=5000)

