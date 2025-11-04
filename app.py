from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO
from supabase import create_client, Client
import pandas as pd
import requests
import urllib.parse
import os

# Flask + SocketIO 설정
app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*")

# Supabase 연결 정보
SUPABASE_URL = "https://👉여기에_당신의_supabase_url👈"
SUPABASE_KEY = "👉여기에_당신의_anon_key👈"
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# 네이버 API 키
NAVER_CLIENT_ID = "👉네이버_CLIENT_ID👈"
NAVER_CLIENT_SECRET = "👉네이버_CLIENT_SECRET👈"


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/upload", methods=["POST"])
def upload():
    """엑셀 업로드 → Supabase에 저장"""
    file = request.files["file"]
    df = pd.read_excel(file)

    for _, row in df.iterrows():
        addr = str(row["주소"])
        meter = str(row["계기번호"])

        # 주소 → 좌표 변환
        encoded_address = urllib.parse.quote(addr)
        url = f"https://maps.apigw.ntruss.com/map-geocode/v2/geocode?query={encoded_address}"
        headers = {
            "x-ncp-apigw-api-key-id": NAVER_CLIENT_ID,
            "x-ncp-apigw-api-key": NAVER_CLIENT_SECRET,
        }

        res = requests.get(url, headers=headers)
        if res.status_code == 200 and res.json().get("addresses"):
            info = res.json()["addresses"][0]
            x, y = float(info["x"]), float(info["y"])
            postal_code = None
            for e in info.get("addressElements", []):
                if "POSTAL_CODE" in e["types"]:
                    postal_code = e["longName"]
                    break
            if not postal_code:
                postal_code = f"LOC_{round(x,4)}_{round(y,4)}"

            supabase.table("field_data").insert({
                "meter": meter,
                "address": addr,
                "status": "미방문",
                "x": x,
                "y": y,
                "postal_code": postal_code
            }).execute()

    return jsonify({"success": True})


@app.route("/get_data", methods=["GET"])
def get_data():
    """Supabase 데이터 조회"""
    data = supabase.table("field_data").select("*").execute()
    return jsonify(data.data)


@app.route("/update_status", methods=["POST"])
def update_status():
    """마커 상태 변경"""
    req = request.get_json()
    postal_code = req["postal_code"]
    status = req["status"]

    # 동일 우편번호 전체 변경
    supabase.table("field_data").update({"status": status}).eq("postal_code", postal_code).execute()

    # 실시간 브로드캐스트
    socketio.emit("status_updated", {"postal_code": postal_code, "status": status})

    return jsonify({"success": True})


if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=5000, debug=True)
