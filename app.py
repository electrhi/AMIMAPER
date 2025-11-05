import eventlet
eventlet.monkey_patch()

from flask import Flask, render_template, request, jsonify, session, redirect, url_for
from flask_socketio import SocketIO
from supabase import create_client, Client
import pandas as pd
import requests, os, json, urllib.parse

# -----------------------------
# Flask 초기화
# -----------------------------
app = Flask(__name__)
app.secret_key = "super_secret_key"
socketio = SocketIO(app, cors_allowed_origins="*")

# -----------------------------
# 환경 변수
# -----------------------------
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
KAKAO_API_KEY = os.getenv("KAKAO_API_KEY")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# -------------------------------------------------------------------------
# 로그인
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
    return render_template("index.html", user=session["user"], kakao_api_key=KAKAO_API_KEY)

# -------------------------------------------------------------------------
# 데이터 가져오기
# -------------------------------------------------------------------------
@app.route("/get_data")
def get_data():
    dataset = session.get("dataset")
    if not dataset:
        return jsonify([])

    rows = supabase.table("field_data").select("*").eq("dataset", dataset).execute().data
    return jsonify(rows)

# -------------------------------------------------------------------------
# 상태 업데이트 (동일 우편번호 일괄처리)
# -------------------------------------------------------------------------
@app.route("/update_status", methods=["POST"])
def update_status():
    data = request.json
    dataset = session.get("dataset")
    postal_code = data["postal_code"]
    new_status = data["status"]

    supabase.table("field_data").update({"status": new_status}) \
        .eq("dataset", dataset).eq("postal_code", postal_code).execute()

    socketio.emit("status_updated", {"postal_code": postal_code, "status": new_status}, broadcast=True)
    return jsonify({"message": "ok"})

# -------------------------------------------------------------------------
# 엑셀 업로드 (디버그 로그 + 한글 컬럼 자동 감지 + 인식 강화)
# -------------------------------------------------------------------------
@app.route("/upload", methods=["GET", "POST"])
def upload():
    if "user" not in session:
        return redirect(url_for("login"))

    if request.method == "POST":
        file = request.files["file"]
        if not file:
            return render_template("upload.html", error="⚠️ 파일이 선택되지 않았습니다.")

        try:
            # ✅ 엑셀 / CSV 자동 판별 + 디버깅용 로깅
            if file.filename.endswith(".xlsx"):
                df = pd.read_excel(file, dtype=str)
            else:
                df = pd.read_csv(file, dtype=str)

            print("\n📂 [DEBUG] 파일명:", file.filename)
            print("📋 [DEBUG] 원본 컬럼 목록:", list(df.columns))
            print("🔍 [DEBUG] 총 행 수:", len(df))
            print("🧾 [DEBUG] 첫 3행 미리보기:\n", df.head(3))
            print("-" * 60)

        except Exception as e:
            print("❌ [ERROR] 엑셀 파일을 읽는 중 오류:", e)
            return render_template("upload.html", error=f"❌ 엑셀 파일을 읽는 중 오류 발생: {e}")

        # ✅ 컬럼명 전처리: 공백 제거, 소문자 변환
        df.columns = [str(c).strip() for c in df.columns]
        print("✅ [DEBUG] 정제된 컬럼명:", df.columns.tolist())

        # ✅ 가능한 컬럼 이름 매핑
        address_cols = ["address", "주소", "주소지"]
        meter_cols = ["meters", "계기번호", "계기", "meter"]

        dataset = session["dataset"]
        inserted = 0

        for _, row in df.iterrows():
            address = ""
            for c in address_cols:
                for col in df.columns:
                    if c in col:
                        address = str(row[col]).strip()
                        break
                if address:
                    break

            meter = ""
            for c in meter_cols:
                for col in df.columns:
                    if c in col:
                        meter = str(row[col]).strip()
                        break
                if meter:
                    break

            if not address:
                continue

            # ✅ Kakao Local API 호출
            try:
                url = f"https://dapi.kakao.com/v2/local/search/address.json?query={urllib.parse.quote(address)}"
                headers = {"Authorization": f"KakaoAK {KAKAO_API_KEY}"}
                res = requests.get(url, headers=headers)
                data = res.json()

                if data.get("documents"):
                    loc = data["documents"][0]
                    x, y = float(loc["x"]), float(loc["y"])
                    postal_code = loc.get("road_address", {}).get("zone_no") if loc.get("road_address") else None

                    supabase.table("field_data").insert({
                        "dataset": dataset,
                        "address": address,
                        "meters": [meter],
                        "x": x,
                        "y": y,
                        "postal_code": postal_code,
                        "status": "미방문"
                    }).execute()
                    inserted += 1

            except Exception as e:
                print(f"⚠️ [WARNING] '{address}' 변환 중 오류 발생:", e)
                continue

        print(f"✅ [DEBUG] 총 {inserted}개의 주소가 변환되어 Supabase에 저장되었습니다.\n")

        return render_template("upload.html", message=f"✅ {inserted}개의 주소가 업로드 및 변환되었습니다.")
    return render_template("upload.html")

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
