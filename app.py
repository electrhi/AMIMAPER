from flask import Flask, render_template, request, jsonify, session, redirect, url_for
from supabase import create_client, Client
from flask_socketio import SocketIO, emit
import pandas as pd
import requests
import urllib.parse
import os

# Flask + SocketIO 초기화
app = Flask(__name__)
app.secret_key = "super_secret_key"  # 나중에 환경변수로 변경 가능
socketio = SocketIO(app, cors_allowed_origins="*")

# Supabase 연결
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# 메인 페이지 (로그인 필요)
@app.route("/")
def index():
    if "user" not in session:
        return redirect(url_for("login"))
    return render_template("index.html", username=session["user"])

# 로그인 페이지
@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "GET":
        return render_template("login.html")

    username = request.form["username"]
    password = request.form["password"]

    user = (
        supabase.table("users")
        .select("*")
        .eq("username", username)
        .eq("password", password)
        .execute()
    )

    if len(user.data) > 0:
        session["user"] = username
        session["dataset"] = user.data[0]["dataset"]
        return redirect(url_for("index"))
    else:
        return "❌ 아이디 또는 비밀번호가 잘못되었습니다.", 401

# 로그아웃
@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))

# Supabase → 지도 데이터 로드
@app.route("/get_data")
def get_data():
    if "user" not in session:
        return redirect(url_for("login"))

    dataset = session["dataset"]
    data = supabase.table("field_data").select("*").eq("dataset", dataset).execute()
    return jsonify(data.data)

# 상태 변경 API (마커 버튼 클릭)
@app.route("/update_status", methods=["POST"])
def update_status():
    if "user" not in session:
        return jsonify({"error": "Unauthorized"}), 403

    dataset = session["dataset"]
    postal_code = request.json["postal_code"]
    new_status = request.json["status"]

    supabase.table("field_data").update({"status": new_status})\
        .eq("dataset", dataset)\
        .eq("postal_code", postal_code)\
        .execute()

    # 실시간 전송
    socketio.emit("status_update", {"postal_code": postal_code, "status": new_status}, broadcast=True)
    return jsonify({"success": True})

# 엑셀 업로드 → Supabase에 저장
@app.route("/upload", methods=["POST"])
def upload():
    if "user" not in session:
        return jsonify({"error": "Unauthorized"}), 403

    file = request.files["file"]
    df = pd.read_excel(file)
    dataset = session["dataset"]

    for _, row in df.iterrows():
        address = str(row["주소"])
        meter = str(row["계기번호"])

        encoded_address = urllib.parse.quote(address)
        url = f"https://maps.apigw.ntruss.com/map-geocode/v2/geocode?query={encoded_address}"
        headers = {
            "x-ncp-apigw-api-key-id": os.getenv("NAVER_CLIENT_ID"),
            "x-ncp-apigw-api-key": os.getenv("NAVER_CLIENT_SECRET"),
            "Accept": "application/json"
        }

        res = requests.get(url, headers=headers)
        if res.status_code == 200:
            data = res.json()
            if data.get("addresses"):
                addr = data["addresses"][0]
                x, y = float(addr["x"]), float(addr["y"])

                postal_code = None
                for e in addr.get("addressElements", []):
                    if "POSTAL_CODE" in e["types"]:
                        postal_code = e["longName"]
                        break
                if not postal_code:
                    postal_code = f"LOC_{round(x,4)}_{round(y,4)}"

                # 기존 주소 그룹 확인
                existing = (
                    supabase.table("field_data")
                    .select("*")
                    .eq("dataset", dataset)
                    .eq("postal_code", postal_code)
                    .execute()
                )

                if existing.data:
                    meters = existing.data[0]["meters"]
                    meters.append(meter)
                    supabase.table("field_data").update({"meters": meters})\
                        .eq("dataset", dataset)\
                        .eq("postal_code", postal_code)\
                        .execute()
                else:
                    supabase.table("field_data").insert({
                        "dataset": dataset,
                        "postal_code": postal_code,
                        "address": addr.get("roadAddress") or addr.get("jibunAddress") or address,
                        "meters": [meter],
                        "x": x,
                        "y": y,
                        "status": "미방문"
                    }).execute()

    return jsonify({"success": True})

# 소켓 서버 실행
if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=10000)
