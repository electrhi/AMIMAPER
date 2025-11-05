import eventlet
eventlet.monkey_patch()

from flask import Flask, render_template, request, jsonify, session, redirect, url_for
from flask_socketio import SocketIO
from supabase import create_client, Client
import pandas as pd
import requests, os, json, urllib.parse

app = Flask(__name__)
app.secret_key = "super_secret_key"
socketio = SocketIO(app, cors_allowed_origins="*")

# 환경 변수
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
KAKAO_JAVASCRIPT_KEY = os.getenv("KAKAO_JAVASCRIPT_KEY")
KAKAO_REST_API_KEY = os.getenv("KAKAO_REST_API_KEY")

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
# 지도 페이지
# -------------------------------------------------------------------------
@app.route("/")
def index():
    if "user" not in session:
        return redirect(url_for("login"))
    return render_template("index.html", user=session["user"], kakao_javascript_key=KAKAO_JAVASCRIPT_KEY)


# -------------------------------------------------------------------------
# 데이터 가져오기
# -------------------------------------------------------------------------
@app.route("/get_data")
def get_data():
    dataset = session.get("dataset")
    if not dataset:
        return jsonify([])

    rows = supabase.table("field_data").select("*").eq("dataset", dataset).execute().data
    for r in rows:
        if isinstance(r.get("meters"), str):
            try:
                r["meters"] = json.loads(r["meters"])
            except:
                r["meters"] = [r["meters"]]
    return jsonify(rows)


# -------------------------------------------------------------------------
# 상태 업데이트 (우편번호 단위 일괄 변경)
# -------------------------------------------------------------------------
@app.route("/update_status", methods=["POST"])
def update_status():
    data = request.json
    dataset = session.get("dataset")
    postal_code = data["postal_code"]
    new_status = data["status"]

    # 동일 우편번호 전체 상태 변경
    supabase.table("field_data").update({"status": new_status}) \
        .eq("dataset", dataset).eq("postal_code", postal_code).execute()

    # 전체 클라이언트에게 실시간 업데이트 브로드캐스트
    socketio.emit("status_updated", {"postal_code": postal_code, "status": new_status}, broadcast=True)
    return jsonify({"message": "ok"})


# -------------------------------------------------------------------------
# 엑셀 업로드 및 Kakao REST API 변환
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
            if file.filename.endswith(".xlsx"):
                df = pd.read_excel(file, dtype=str)
            else:
                df = pd.read_csv(file, dtype=str)
        except Exception as e:
            return render_template("upload.html", error=f"❌ 엑셀 파일을 읽는 중 오류 발생: {e}")

        df.columns = [str(c).strip() for c in df.columns]
        address_cols = ["address", "주소", "주소지"]
        meter_cols = ["meters", "계기번호", "계기", "meter"]
        status_col = "진행"

        dataset = session["dataset"]
        inserted = 0

        for _, row in df.iterrows():
            address = next((str(row[c]).strip() for c in df.columns if any(x == c or x in c for x in address_cols) and pd.notna(row[c])), "")
            meter = next((str(row[c]).strip() for c in df.columns if any(x == c or x in c for x in meter_cols) and pd.notna(row[c])), "")
            status = row[status_col].strip() if status_col in df.columns and pd.notna(row[status_col]) else "미방문"

            if not address:
                continue

            try:
                url = f"https://dapi.kakao.com/v2/local/search/address.json?query={urllib.parse.quote(address)}"
                headers = {"Authorization": f"KakaoAK {KAKAO_REST_API_KEY}"}
                res = requests.get(url, headers=headers, timeout=10)
                data = res.json()

                if data.get("documents"):
                    loc = data["documents"][0]
                    x, y = float(loc["x"]), float(loc["y"])
                    postal_code = loc.get("road_address", {}).get("zone_no") if loc.get("road_address") else None

                    existing = supabase.table("field_data").select("*").eq("dataset", dataset).eq("postal_code", postal_code).execute().data

                    if existing:
                        existing_meters = json.loads(existing[0]["meters"])
                        if meter not in existing_meters:
                            existing_meters.append(meter)
                            supabase.table("field_data").update({
                                "meters": json.dumps(existing_meters)
                            }).eq("dataset", dataset).eq("postal_code", postal_code).execute()
                    else:
                        supabase.table("field_data").insert({
                            "dataset": dataset,
                            "address": address,
                            "meters": json.dumps([meter]),
                            "x": x,
                            "y": y,
                            "postal_code": postal_code,
                            "status": status
                        }).execute()
                    inserted += 1

            except Exception as e:
                print(f"⚠️ {address} 변환 중 오류: {e}")
                continue

        return render_template("upload.html", message=f"✅ {inserted}개의 주소가 업로드 및 변환되었습니다.")
    return render_template("upload.html")


# -------------------------------------------------------------------------
# 로그아웃
# -------------------------------------------------------------------------
@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=5000)
