/**
 * DeviceMirrorDock — live device screen mirror with click-to-tap control and an
 * on-device profiler (gfxinfo framestats FPS, jank, frame-time percentiles, PSS).
 *
 * Dev-server feature: frames come from `GET /api/device/screen` (adb screencap),
 * taps go through `POST /api/device/input` (adb shell input), stats from
 * `GET /api/device/stats`. Inside the packaged APK there is no dev server, so the
 * dock says so explicitly instead of showing a dead mirror.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useStudio } from '../state/StudioState';
import { MonitorSmartphone, RefreshCw, MousePointerClick, Gauge, Play, Pause } from 'lucide-react';

interface DeviceStats {
  ok: boolean;
  fps: number | null;
  jankPercent: number | null;
  totalFrames: number | null;
  percentiles: Record<string, number | null>;
  pssMb: number | null;
  package: string;
  error?: string;
}

const POLL_FRAME_MS = 1500;
const POLL_STATS_MS = 4000;

export const DeviceMirrorDock: React.FC = () => {
  const { devices, selectedDevice, addLog } = useStudio();
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [auto, setAuto] = useState(true);
  const [stats, setStats] = useState<DeviceStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const adbDevice = devices.find(d => d.id !== 'native-container');
  const serial = selectedDevice && selectedDevice !== 'native-container' ? selectedDevice : adbDevice?.id ?? null;

  const refreshFrame = useCallback(async () => {
    if (!serial) return;
    try {
      const res = await fetch(`/api/device/screen?serial=${encodeURIComponent(serial)}&t=${Date.now()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        setError(body.error || `screen fetch failed (${res.status})`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setFrameUrl(prev => {
        if (prev) URL.revokeObjectURL(prev);
        return url;
      });
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'device mirror unavailable');
    }
  }, [serial]);

  const refreshStats = useCallback(async () => {
    if (!serial) return;
    try {
      const res = await fetch(`/api/device/stats?serial=${encodeURIComponent(serial)}&package=com.heretek.gamestudio`);
      const data = (await res.json()) as DeviceStats;
      setStats(data);
    } catch {
      setStats(null);
    }
  }, [serial]);

  useEffect(() => {
    if (!auto || !serial) return;
    const id = setInterval(refreshFrame, POLL_FRAME_MS);
    return () => clearInterval(id);
  }, [auto, serial, refreshFrame]);

  useEffect(() => {
    if (!serial) return;
    void refreshStats();
    const id = setInterval(refreshStats, POLL_STATS_MS);
    return () => clearInterval(id);
  }, [serial, refreshStats]);

  useEffect(() => () => {
    setFrameUrl(prev => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }, []);

  useEffect(() => {
    if (!serial) return;
    void refreshFrame();
  }, [serial, refreshFrame]);

  const handleImageClick = async (event: React.MouseEvent<HTMLImageElement>) => {
    const img = imgRef.current;
    if (!img || !serial || !img.naturalWidth) return;
    const rect = img.getBoundingClientRect();
    // object-fit: contain → account for letterboxing
    const scale = Math.min(rect.width / img.naturalWidth, rect.height / img.naturalHeight);
    const displayWidth = img.naturalWidth * scale;
    const displayHeight = img.naturalHeight * scale;
    const offsetX = (rect.width - displayWidth) / 2;
    const offsetY = (rect.height - displayHeight) / 2;
    const x = (event.clientX - rect.left - offsetX) / scale;
    const y = (event.clientY - rect.top - offsetY) / scale;
    if (x < 0 || y < 0 || x > img.naturalWidth || y > img.naturalHeight) return;

    try {
      const res = await fetch('/api/device/input', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serial, action: 'tap', x, y })
      });
      const data = await res.json();
      addLog(
        data.ok ? 'info' : 'error',
        'DeviceMirror',
        data.ok
          ? `Tap injected at (${Math.round(x)}, ${Math.round(y)}) on ${serial}`
          : `Tap failed: ${data.error || data.stderr || 'unknown error'}`
      );
    } catch (e: any) {
      addLog('error', 'DeviceMirror', `Input bridge unavailable: ${e.message}`);
    }
  };

  if (!serial) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 p-6 text-center text-xs text-zinc-500">
        <MonitorSmartphone className="w-6 h-6 text-zinc-600" />
        <div>No ADB device attached — the mirror needs `adb devices`.</div>
        <div className="text-[11px] text-zinc-600">
          In the packaged APK this dock is inactive (no dev server); the native bridge shows the device in the header.
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-[#18181b] text-xs">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800 bg-[#202023]">
        <div className="flex items-center gap-2">
          <MonitorSmartphone className="w-4 h-4 text-sky-400" />
          <span className="font-semibold text-zinc-100">Device Mirror</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-300 border border-sky-500/30 font-mono">
            {serial}
          </span>
          {dimensions && (
            <span className="text-[10px] text-zinc-500 font-mono">
              {dimensions.width}×{dimensions.height}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setAuto(a => !a)}
            className={`flex items-center gap-1 px-2 py-1 rounded border text-[11px] transition-colors ${
              auto ? 'bg-emerald-950/60 border-emerald-600/50 text-emerald-300' : 'bg-zinc-900 border-zinc-700 text-zinc-400'
            }`}
            title={auto ? 'Pause live mirroring' : 'Resume live mirroring'}
          >
            {auto ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
            {auto ? 'Live' : 'Paused'}
          </button>
          <button
            onClick={() => { void refreshFrame(); void refreshStats(); }}
            className="flex items-center gap-1 px-2 py-1 rounded bg-zinc-900 border border-zinc-700 text-zinc-300 hover:text-white"
            title="Refresh frame and stats"
          >
            <RefreshCw className="w-3 h-3" />
            Refresh
          </button>
        </div>
      </div>

      {/* Profiler strip */}
      <div className="grid grid-cols-4 gap-2 px-3 py-2 border-b border-zinc-800">
        <div className="bg-[#202023] rounded border border-zinc-800 p-2">
          <div className="text-[10px] text-zinc-500 flex items-center gap-1"><Gauge className="w-3 h-3" /> FPS (framestats)</div>
          <div className="text-sm font-bold text-emerald-300">{stats?.fps ?? '—'}</div>
        </div>
        <div className="bg-[#202023] rounded border border-zinc-800 p-2">
          <div className="text-[10px] text-zinc-500">Janky frames</div>
          <div className="text-sm font-bold text-amber-300">{stats?.jankPercent != null ? `${stats.jankPercent}%` : '—'}</div>
        </div>
        <div className="bg-[#202023] rounded border border-zinc-800 p-2">
          <div className="text-[10px] text-zinc-500">p90 / p99 frame</div>
          <div className="text-sm font-bold text-zinc-200">
            {stats?.percentiles?.p90 != null ? `${stats.percentiles.p90}/${stats.percentiles.p99 ?? '—'}ms` : '—'}
          </div>
        </div>
        <div className="bg-[#202023] rounded border border-zinc-800 p-2">
          <div className="text-[10px] text-zinc-500">Memory PSS</div>
          <div className="text-sm font-bold text-sky-300">{stats?.pssMb != null ? `${stats.pssMb} MB` : '—'}</div>
        </div>
      </div>

      {/* Mirror */}
      <div className="flex-1 relative overflow-hidden bg-black flex items-center justify-center">
        {frameUrl ? (
          <img
            ref={imgRef}
            src={frameUrl}
            alt="device screen"
            onLoad={e => setDimensions({ width: (e.target as HTMLImageElement).naturalWidth, height: (e.target as HTMLImageElement).naturalHeight })}
            onClick={handleImageClick}
            className="max-h-full max-w-full object-contain cursor-crosshair select-none"
            draggable={false}
          />
        ) : (
          <div className="text-zinc-600 text-xs">{error ? `Mirror unavailable: ${error}` : 'Waiting for first frame…'}</div>
        )}
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1 px-2 py-1 rounded bg-black/70 border border-zinc-700 text-[10px] text-zinc-300">
          <MousePointerClick className="w-3 h-3 text-sky-400" />
          Click the frame to inject a tap at that device coordinate
        </div>
      </div>
    </div>
  );
};

export default DeviceMirrorDock;
