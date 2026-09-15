import { defineConfig } from "vite";
import baseConfig from "./vite.config.js";
import { amimapSupabaseSingletonPlugin } from "./vite.supabase-singleton.js";
import { amimapExcelPerformancePlugin } from "./vite.performance-excel.js";
import { amimapCorePerformancePlugin } from "./vite.performance-core.js";
import { amimapSafeAddressMatchPlugin } from "./vite.safe-address-match.js";
import { amimapPriorityPlugin } from "./vite.priority.js";
import { amimapFilteredCountsPlugin } from "./vite.filtered-counts.js";
import { amimapMarkerClusterPlugin } from "./vite.marker-cluster.js";
import { amimapClusterMeterCountPlugin } from "./vite.cluster-meter-count.js";
import { amimapRealtimeCollaborationPlugin } from "./vite.realtime-collab.js";
import { amimapPopupStabilityPlugin } from "./vite.popup-stability.js";
import { amimapMixedInipjuDigitalColorPlugin } from "./vite.mixed-inipju-digital-color.js";
import { amimapAdminCurrentLocationPlugin } from "./vite.admin-current-location.js";
import { amimapMapTypeLabelPlugin } from "./vite.map-type-label.js";
import { amimapTopActionsLayoutPlugin } from "./vite.top-actions-layout.js";
import { amimapCommLabelModePlugin } from "./vite.comm-label-mode.js";

const inheritedPlugins = Array.isArray(baseConfig?.plugins) ? baseConfig.plugins : [];

export default defineConfig({
  ...baseConfig,
  plugins: [
    ...inheritedPlugins,
    amimapSupabaseSingletonPlugin(),
    amimapExcelPerformancePlugin(),
    amimapCorePerformancePlugin(),
    amimapSafeAddressMatchPlugin(),
    amimapPriorityPlugin(),
    amimapFilteredCountsPlugin(),
    amimapMarkerClusterPlugin(),
    amimapClusterMeterCountPlugin(),
    amimapRealtimeCollaborationPlugin(),
    amimapPopupStabilityPlugin(),
    amimapMixedInipjuDigitalColorPlugin(),
    amimapAdminCurrentLocationPlugin(),
    amimapMapTypeLabelPlugin(),
    amimapTopActionsLayoutPlugin(),
    amimapCommLabelModePlugin(),
  ],
});
