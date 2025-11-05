import os
import pandas as pd
import requests
from flask import Flask, render_template, request, jsonify
from supabase import create_client

app = Flask(__name__)

# ✅ 환경변수 분리 (Render의 Environment 탭에 추가)
KAKAO_JAVASCRIPT_KEY = os.getenv("KAKAO_JAVASCRIPT_KEY")
KAKAO_REST_API_KEY = os.getenv("KAKAO_REST_API_KEY")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

@app.route("/")
def index():
    return render_template("index.html", kakao_javascript_key=KAKAO_JAVASCRIPT_KEY)

@app.route("/upload")
def upload_page():
    return render_template("upload.html")

@app.route("/upload", methods=["POST"])
def upload_file():
    if "file" not in request.files:
        return jsonify({"error": "파일이 없습니다."}), 400

    file = request.files["file"]
    df = pd.read_excel(file)

    print("\n📂 [DEBUG] 파일명:", file.filename)
    print("📋 [DEBUG] 원본 컬럼 목록:", list(df.columns))
    print("🔍 [DEBUG] 총 행 수:", len(df))
    print("🧾 [DEBUG] 첫 3행 미리보기:\n", df.head(3))
    print("-" * 60)

    # 한글/영문 컬럼 자동 탐지
    address_col = next((col for col in df.columns if "주소" in col or "address" in col.lower()), None)
    meter_col = next((col for col in df.columns if "계기" in col or "meter" in col.lower()), None)

    if not address_col:
        return jsonify({"error": "주소 컬럼을 찾을 수 없습니다."}), 400

    success_count = 0

    for _, row in df.iterrows():
        address = str(row[address_col]).strip()
        meter = str(row[meter_col]).strip() if meter_col else ""

        print(f"📍 [DEBUG] 추출된 주소: '{address}', 계기번호: '{meter}'")

        headers = {"Authorization": f"KakaoAK {KAKAO_REST_API_KEY}"}
        params = {"query": address}
        res = requests.get("https://dapi.kakao.com/v2/local/search/address.json",
                           headers=headers, params=params)

        result = res.json()
        print(f"🌐 [DEBUG] Kakao API 응답 ({address}): {result}")

        # 주소 → 좌표 변환 성공 시
        if "documents" in result and len(result["documents"]) > 0:
            doc = result["documents"][0]
            lat, lng = float(doc["y"]), float(doc["x"])

            supabase.table("field_data").insert({
                "address": address,
                "lat": lat,
                "lng": lng,
                "meter_id": meter,
                "status": "미방문"
            }).execute()

            success_count += 1
        else:
            print(f"⚠️ [WARNING] '{address}' → Kakao API에서 좌표를 찾지 못했습니다.")

    print(f"✅ [DEBUG] 총 {success_count}개의 주소가 변환되어 Supabase에 저장되었습니다.\n")

    return render_template("upload.html", message=f"{success_count}개의 주소가 업로드 및 변환되었습니다.")

@app.route("/get_data")
def get_data():
    data = supabase.table("field_data").select("*").execute().data
    return jsonify(data)

if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)
