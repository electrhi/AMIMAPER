const replaceRequired = (code, target, replacement, label) => {
  if (!code.includes(target)) {
    throw new Error(`AMIMAPER Supabase singleton transform failed: ${label}`);
  }
  return code.replace(target, replacement);
};

export const amimapSupabaseSingletonPlugin = () => ({
  name: "amimap-supabase-singleton",
  enforce: "pre",
  transform(source, id) {
    const isMain = id.endsWith("/src/main.jsx") || id.endsWith("\\src\\main.jsx");
    const isPhoneSupport =
      id.endsWith("/src/phone-support.js") || id.endsWith("\\src\\phone-support.js");

    if (!isMain && !isPhoneSupport) return null;

    let code = source;
    code = replaceRequired(
      code,
      'import { createClient } from "@supabase/supabase-js";',
      'import { supabase } from "./supabase-client.js";',
      `${isMain ? "main" : "phone-support"} createClient import`
    );

    code = replaceRequired(
      code,
      "const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);",
      "// Supabase client is shared from ./supabase-client.js",
      `${isMain ? "main" : "phone-support"} client initialization`
    );

    return { code, map: null };
  },
});
