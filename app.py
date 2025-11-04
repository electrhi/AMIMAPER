import eventlet
eventlet.monkey_patch()

from flask import Flask, render_template, request, jsonify, session, redirect, url_for
from flask_socketio import SocketIO
from supabase import create_client, Client
import requests, json, urllib.parse, os

# -----------------------------
# Flask 초기화
# -----------------------------
app = Flask(__name__)
app.secret_key = "super_secret_key"
socketio = SocketIO(app, cors_allowed_origins="*")

# -----------------------------
# 환경 변수 불러오기
# -----------------------------
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
KAKAO_API_KEY = os.getenv("KAKAO_API_KEY")

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
# 지도 메인 페이지 (카카오 지도 버전)
# -------------------------------------------------------------------------
@app.route("/")
def index():
    if "user" not in session:
        return redirect(url_for("login"))
    return render_template(
        "index.html",
        user=session["user"],
        kakao_api_key=KAKAO_API_KEY
    )

# -------------------------------------------------------------------------
# Supabase 데이터 불러오기
# -------------------------------------------------------------------------
@app.route("/get_data")
def get_data():
    if "dataset" not in session:
        return jsonify([])

    dataset = session["dataset"]
    rows = supabase.table("field_data").select("*").eq("dataset", dataset).execute().data

    results = []
    for item in rows:
        results.append({
            "id": item.get("id"),
            "dataset": dataset,
            "postal_code": item.get("postal_code"),
            "address": item.get("address"),
            "meters": item.get("meters") if isinstance(item.get("meters"), list) else [item.get("meters")],
            "x": item.get("x"),
            "y": item.get("y"),
            "status": item.get("status", "미방문")
        })

    return jsonify(results)

# -------------------------------------------------------------------------
# 상태 업데이트
# -------------------------------------------------------------------------
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

# -------------------------------------------------------------------------
# 로그아웃
# -------------------------------------------------------------------------
@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))

# -------------------------------------------------------------------------
# 실행
# -------------------------------------------------------------------------
if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=5000)
