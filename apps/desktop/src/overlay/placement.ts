import type { OverlaySettings } from "./model";

export type MonitorGeometry = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ResolvedPlacement = {
  monitorId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  recovered: boolean;
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function normalizeSettings(settings: OverlaySettings): OverlaySettings {
  return {
    ...settings,
    xNormalized: clamp(settings.xNormalized, 0, 1),
    yNormalized: clamp(settings.yNormalized, 0, 1),
    widthNormalized: clamp(settings.widthNormalized, 0.3, 0.95),
    heightNormalized: clamp(settings.heightNormalized, 0.05, 0.9),
    fontScale: clamp(settings.fontScale, 0.8, 1.6),
    backgroundOpacity: clamp(settings.backgroundOpacity, 0.35, 0.9),
  };
}

export function resolvePlacement(
  settings: OverlaySettings,
  monitors: readonly MonitorGeometry[],
  primaryMonitorId: string | null,
): ResolvedPlacement | null {
  if (monitors.length === 0) {
    return null;
  }

  const requested = monitors.find(
    (monitor) => monitor.id === settings.monitorId,
  );
  const primary =
    monitors.find((monitor) => monitor.id === primaryMonitorId) ?? monitors[0];

  if (primary === undefined) {
    return null;
  }

  const monitor = requested ?? primary;
  const normalized = normalizeSettings(settings);
  const width = Math.round(monitor.width * normalized.widthNormalized);
  const height = Math.min(
    Math.round(monitor.height * normalized.heightNormalized),
    monitor.height,
  );
  const movableWidth = Math.max(0, monitor.width - width);
  const movableHeight = Math.max(0, monitor.height - height);

  return {
    monitorId: monitor.id,
    x: Math.round(monitor.x + movableWidth * normalized.xNormalized),
    y: Math.round(monitor.y + movableHeight * normalized.yNormalized),
    width,
    height,
    recovered: requested === undefined && settings.monitorId !== null,
  };
}

export function placementFromPixels(
  settings: OverlaySettings,
  monitor: MonitorGeometry,
  x: number,
  y: number,
  width: number,
  height: number,
): OverlaySettings {
  const movableWidth = Math.max(1, monitor.width - width);
  const movableHeight = Math.max(1, monitor.height - height);

  return normalizeSettings({
    ...settings,
    monitorId: monitor.id,
    xNormalized: (x - monitor.x) / movableWidth,
    yNormalized: (y - monitor.y) / movableHeight,
    widthNormalized: width / monitor.width,
    heightNormalized: height / monitor.height,
  });
}
