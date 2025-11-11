/**
 * Excel → Supabase Table Uploader
 * for meters_base table
 */

import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const EXCEL_PATH = process.env.EXCEL_PATH;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function uploadExcel() {
  console.log("📂 Loading Excel file:", EXCEL_PATH);
  const buf = fs.readFileSync(EXCEL_PATH);
  const workbook = XLSX.read(buf, { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet);
  console.log(`✅ Loaded ${rows.length.toLocaleString()} rows from Excel.`);

  // Convert to DB-ready rows
  const data = rows.map((r) => ({
    meter_id: r["계기번호"] ? String(r["계기번호"]) : null,
    address: r["주소"] || "",
    status: r["진행"] || "미방문",
  }));

  // Split into manageable chunks (Supabase limit ~1MB per insert)
  const chunkSize = 5000;
  console.log("🚀 Uploading in chunks of", chunkSize);

  for (let i = 0; i < data.length; i += chunkSize) {
    const chunk = data.slice(i, i + chunkSize);
    console.log(`📤 Uploading rows ${i + 1} - ${i + chunk.length} ...`);
    const { error } = await supabase.from("meters_base").insert(chunk);
    if (error) {
      console.error("❌ Upload failed:", error.message);
      process.exit(1);
    }
  }

  console.log("🎉 All data uploaded successfully!");
}

uploadExcel().catch((e) => console.error("Fatal:", e.message));
