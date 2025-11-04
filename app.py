import os
import json
import urllib.parse
import requests
import eventlet
eventlet.monkey_patch()

from flask import Flask, render_template, request, jsonify, session, redirect, url_for
from flask_socketio import SocketIO
from supabase import create_client, Client

app = Flask(__name__)
app.secret_key = os.getenv("FLASK_SECRET", "super_secret_key")
socketio = SocketIO(app, cors_allowed_origins="*")

# env
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
NAVER_CLIENT_ID = os.getenv("NAVER_CLIENT_ID")
NAVER_CLIENT_SECRET = os.getenv("NAVER_CLIENT_SECRET")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("❌ SUPABASE_URL 또는 SUPABASE_KEY 환경변수가 설정되지 않았습니다.")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)


@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        username = request.form["username"]
        password = request.form["password"]

        users = supabase.table("users").select("*").eq("username", username).execute().data
        # NOTE: 데모용 평문 비교
        if users and users[0].get("password") == password:
            session["user"] = username
            session["dataset"] = users[0].get("dataset")
            return redirect(url_for("index"))
        return render_template("login.html", error="❌ 아이디 또는 비밀번호가 올바르지 않습니다.")
    return render_template("login.html")


@app.route("/")
def index():
    if "user" not in session:
        return redirect(url_for("login"))
    return render_template(
        "index.html",
        user=session["user"],
        naver_client_id=NAVER_CLIENT_ID,
    )


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

        # meters 파싱
        raw_meters = item.get("meters")
        meters = []
        if isinstance(raw_meters, list):
            meters = raw_meters
        elif isinstance(raw_meters, str) and raw_meters.strip():
            try:
                if raw_meters.strip().startswith("["):
                    meters = json.loads(raw_meters)
                else:
                    meters = [m.strip() for m in raw_meters.split(",") if m.strip()]
            except Exception:
                meters = [raw_meters]

        # 좌표 없으면 네이버 지오코딩
        if address and (not x or not y):
            try:
                encoded = urllib.parse.quote(address)
                url = f"https://maps.apigw.ntruss.com/map-geocode/v2/geocode?query={encoded}"
                headers = {
                    "x-ncp-apigw-api-key-id": NAVER_CLIENT_ID,
                    "x-ncp-apigw-api-key": NAVER_CLIENT_SECRET,
                    "Accept": "application/json"
                }
                res = requests.get(url, headers=headers, timeout=5)
                res.raise_for_status()
                data = res.json()
                if data.get("addresses"):
                    addr = data["addresses"][0]
                    x, y = float(addr["x"]), float(addr["y"])
                    postal_code = next(
                        (e["longName"] for e in addr["addressElements"] if "POSTAL_CODE" in e["types"]), None
                    )
                    supabase.table("field_data").update({
                        "x": x, "y": y, "postal_code": postal_code
                    }).eq("id", item["id"]).execute()
            except Exception as e:
                print("geocoding error:", e)

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


@app.route("/update_status", methods=["POST"])
def update_status():
    data = request.json
    dataset = session.get("dataset")
    postal_code = data["postal_code"]
    new_status = data["status"]

    supabase.table("field_data").update({"status": new_status}) \
        .eq("dataset", dataset).eq("postal_code", postal_code).execute()

    socketio.emit("status_updated", {
        "postal_code": postal_code,
        "status": new_status
    }, broadcast=True)

    return jsonify({"message": "ok"})


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=5000)
