import { defineConfig } from "vite";
import baseConfig from "./vite.config.js";
import { amimapExcelPerformancePlugin } from "./vite.performance-excel.js";
import { amimapCorePerformancePlugin } from "./vite.performance-core.js";
import { amimapPriorityPlugin } from "./vite.priority.js";
import { amimapFilteredCountsPlugin } from "./vite.filtered-counts.js";
import { amimapMarkerClusterPlugin } from "./vite.marker-cluster.js";
import { amimapClusterMeterCountPlugin } from "./vite.cluster-meter-count.js";
import { amimapRealtimeCollaborationPlugin } from "./vite.realtime-collab.js";
import { amimapPopupStabilityPlugin } from "./vite.popup-stability.js";
import { amimapMixedInipjuDigitalColorPlugin } from "./vite.mixed-inipju-digital-color.js";

const inheritedPlugins = Array.isArray(baseConfig?.plugins) ? baseConfig.plugins : [];

export default defineConfig({
  ...baseConfig,
  plugins: [
    ...inheritedPlugins,
    amimapExcelPerformancePlugin(),
    amimapCorePerformancePlugin(),
    amimapPriorityPlugin(),
    amimapFilteredCountsPlugin(),
    amimapMarkerClusterPlugin(),
    amimapClusterMeterCountPlugin(),
    amimapRealtimeCollaborationPlugin(),
    amimapPopupStabilityPlugin(),
    amimapMixedInipjuDigitalColorPlugin(),
  ],
});
