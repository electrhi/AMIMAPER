import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY;

// 브라우저 컨텍스트에서 하나의 Supabase/GoTrueClient 인스턴스만 공유합니다.
export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
