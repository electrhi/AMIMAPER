import baseConfig from "./vite.base-config.js";
import { meterLabelModePlugin } from "./vite.meter-label-mode.js";

const basePlugins = Array.isArray(baseConfig?.plugins) ? baseConfig.plugins : [];

export default {
  ...baseConfig,
  plugins: [
    ...(basePlugins.length > 0 ? [basePlugins[0]] : []),
    meterLabelModePlugin(),
    ...basePlugins.slice(1),
  ],
};
