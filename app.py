# ----------------------------------------------------
# 🧩 eventlet는 가장 먼저 patch 적용해야 함
# ----------------------------------------------------
import eventlet
eventlet.monkey_patch()

# ----------------------------------------------------
# 표준 라이브러리 및 패키지 import
# ----------------------------------------------------
from flask import Flask, render_template, request, jsonify, redirect, url_for, session
from flask_cors import CORS
from flask_socketio import SocketIO
from supabase import create_client, Client
import os
import pandas as pd
import io

import logging
log = logging.getLogger('werkzeug')
log.setLevel(logging.WARNING)



# ----------------------------------------------------
# Flask 초기 설정
# ----------------------------------------------------
app = Flask(__name__)
CORS(app)
app.secret_key = os.getenv("FLASK_SECRET_KEY", "supersecretkey")

# SocketIO 초기화 (eventlet 기반)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="eventlet")

# ----------------------------------------------------
# Supabase 클라이언트 초기화
# ----------------------------------------------------
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise ValueError("❌ SUPABASE_URL 또는 SUPABASE_KEY 환경변수가 설정되지 않았습니다.")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# ----------------------------------------------------
# 로그인 / 세션 관리
# ----------------------------------------------------
@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        user_id = request.form.get("user_id")
        if user_id:
            session["user"] = user_id
            print(f"🔐 로그인 성공: {user_id}")
            return redirect(url_for("index"))
        else:
            print("❌ 로그인 실패: user_id 없음")
            return render_template("login.html", error="아이디를 입력해주세요.")
    return render_template("login.html")

@app.route("/logout")
def logout():
    user = session.pop("user", None)
    print(f"🚪 로그아웃: {user}")
    return redirect(url_for("login"))

# ----------------------------------------------------
# 메인 페이지
# ----------------------------------------------------
@app.route("/")
def index():
    if "user" not in session:
        print("⚠️ 세션 없음 → 로그인 페이지 이동")
        return redirect(url_for("login"))
    kakao_key = os.getenv("KAKAO_JAVASCRIPT_KEY", "")
    print(f"✅ 메인 페이지 로드: {session['user']}")
    return render_template("index.html", kakao_javascript_key=kakao_key)

# ----------------------------------------------------
# 데이터 로드 (지도 마커용)
# ----------------------------------------------------
@app.route("/get_data")
def get_data():
    try:
        response = supabase.table("field_data").select("*").execute()
        data = response.data
        print(f"✅ get_data: {len(data)}건 로드됨")
        return jsonify(data)
    except Exception as e:
        print("💥 get_data 오류:", e)
        return jsonify({"error": str(e)}), 500

# ----------------------------------------------------
# 상태 업데이트
# ----------------------------------------------------
@app.route("/update_status", methods=["POST"])
def update_status():
    try:
        data = request.get_json()
        print("📥 /update_status 요청 수신:", data)

        postal_code = data.get("postal_code")
        status = data.get("status")

        if not postal_code or not status:
            return jsonify({"error": "missing postal_code or status"}), 400

        result = (
            supabase.table("field_data")
            .update({"status": status})
            .eq("postal_code", postal_code)
            .execute()
        )

        print("🧾 Supabase 업데이트 결과:", result)

        socketio.emit("status_updated", {"postal_code": postal_code, "status": status})
        return jsonify({"message": "ok", "updated": result.data}), 200
    except Exception as e:
        print("💥 /update_status 오류 발생:", e)
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

# ----------------------------------------------------
# 엑셀 업로드 → Supabase 반영
# ----------------------------------------------------
@app.route("/upload_excel", methods=["POST"])
def upload_excel():
    try:
        if "file" not in request.files:
            return jsonify({"error": "파일이 없습니다."}), 400

        file = request.files["file"]
        if not file.filename.endswith((".xls", ".xlsx")):
            return jsonify({"error": "엑셀 파일만 업로드 가능합니다."}), 400

        df = pd.read_excel(io.BytesIO(file.read()))
        print("📊 업로드된 엑셀 컬럼:", list(df.columns))

        records = df.to_dict(orient="records")
        for record in records:
            postal = str(record.get("postal_code", "")).strip()
            if not postal:
                continue
            existing = supabase.table("field_data").select("*").eq("postal_code", postal).execute()
            if existing.data:
                supabase.table("field_data").update(record).eq("postal_code", postal).execute()
            else:
                supabase.table("field_data").insert(record).execute()

        print(f"✅ 엑셀 업로드 완료 ({len(records)}건)")
        return jsonify({"message": "ok", "count": len(records)})

    except Exception as e:
        print("💥 엑셀 업로드 오류:", e)
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

# ----------------------------------------------------
# Socket.IO 이벤트
# ----------------------------------------------------
@socketio.on("connect")
def handle_connect():
    print("🟢 클라이언트 연결됨")

@socketio.on("disconnect")
def handle_disconnect():
    print("🔴 클라이언트 연결 해제됨")

# ----------------------------------------------------
# 실행 (Render는 gunicorn이 자동 실행)
# ----------------------------------------------------
if __name__ == "__main__":
    print("🚀 Flask 서버 실행 중 (로컬 테스트용)")
    socketio.run(app, host="0.0.0.0", port=10000, debug=True)

