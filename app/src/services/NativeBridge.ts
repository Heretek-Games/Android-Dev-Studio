/**
 * NativeBridge — reads device/build context from the Android container's
 * `AndroidBridge` JavaScript interface.
 *
 * Inside the packaged APK there is no Vite dev server, so the `/api/*` bridges are
 * unavailable; the native bridge is the authoritative device identity there.
 */

export interface NativeDeviceInfo {
  nativeBridge: true;
  model: string;
  manufacturer: string;
  device: string;
  sdkInt: number;
  abis: string;
  packageName: string;
  appVersion: string;
}

interface AndroidBridgeLike {
  deviceInfo?: () => string;
  vibrate?: (durationMs: number) => void;
  log?: (tag: string, message: string) => void;
}

export function getAndroidBridge(): AndroidBridgeLike | null {
  if (typeof window === 'undefined') return null;
  const bridge = (window as unknown as { AndroidBridge?: AndroidBridgeLike }).AndroidBridge;
  return bridge && typeof bridge.deviceInfo === 'function' ? bridge : null;
}

/** True when running inside the Android container (packaged APK). */
export function isNativeContainer(): boolean {
  return getAndroidBridge() !== null;
}

/** Parsed device context, or null when not running in the container. */
export function readNativeDeviceInfo(): NativeDeviceInfo | null {
  const bridge = getAndroidBridge();
  if (!bridge?.deviceInfo) return null;
  try {
    const parsed = JSON.parse(bridge.deviceInfo()) as Partial<NativeDeviceInfo>;
    if (!parsed || typeof parsed !== 'object' || !parsed.model) return null;
    return {
      nativeBridge: true,
      model: String(parsed.model),
      manufacturer: String(parsed.manufacturer ?? ''),
      device: String(parsed.device ?? ''),
      sdkInt: Number(parsed.sdkInt ?? 0),
      abis: String(parsed.abis ?? ''),
      packageName: String(parsed.packageName ?? ''),
      appVersion: String(parsed.appVersion ?? 'unknown')
    };
  } catch {
    return null;
  }
}

/** Short display label, e.g. "Google Pixel 8 (arm64-v8a) · API 34". */
export function nativeDeviceLabel(info: NativeDeviceInfo): string {
  const primaryAbi = info.abis.split(',')[0] || 'unknown-abi';
  const manufacturer = info.manufacturer.trim();
  const unhelpful = !manufacturer || ['unknown', 'android', 'generic'].includes(manufacturer.toLowerCase());
  const maker = !unhelpful && !info.model.toLowerCase().startsWith(manufacturer.toLowerCase())
    ? `${manufacturer} `
    : '';
  return `${maker}${info.model} (${primaryAbi}) · API ${info.sdkInt}`;
}
