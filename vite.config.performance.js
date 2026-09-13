import { defineConfig } from "vite";
import baseConfig from "./vite.config.js";
import { amimapExcelPerformancePlugin } from "./vite.performance-excel.js";
import { amimapCorePerformancePlugin } from "./vite.performance-core.js";
import { amimapPriorityPlugin } from "./vite.priority.js";
import { amimapRealtimeCollaborationPlugin } from "./vite.realtime-collab.js";

const inheritedPlugins = Array.isArray(baseConfig?.plugins) ? baseConfig.plugins : [];

export default defineConfig({
  ...baseConfig,
  plugins: [
    ...inheritedPlugins,
    amimapExcelPerformancePlugin(),
    amimapCorePerformancePlugin(),
    amimapPriorityPlugin(),
    amimapRealtimeCollaborationPlugin(),
  ],
});
