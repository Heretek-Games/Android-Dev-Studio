import { useCallback, useEffect, useRef, useState } from 'react';
import type { DockviewApi, SerializedDockview } from 'dockview-react';

/**
 * Persistent workspace layouts (Track D.1): named dockview snapshots in
 * localStorage plus last-state auto-restore. Presets stay built-in; user
 * layouts live beside them and survive reloads.
 */

const STORE_KEY = 'heretek.workspace.layouts.v1';
const LAST_KEY = 'heretek.workspace.layouts.last';

function readStore(): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const data = raw ? JSON.parse(raw) : {};
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

export function useWorkspaceLayouts() {
  const apiRef = useRef<DockviewApi | null>(null);
  const [savedNames, setSavedNames] = useState<string[]>(() => Object.keys(readStore()));
  const saveTimer = useRef<number | null>(null);

  const persistLast = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    try {
      localStorage.setItem(LAST_KEY, JSON.stringify(api.toJSON()));
    } catch {
      // Quota or serialization failure must never break the workspace.
    }
  }, []);

  const attach = useCallback((api: DockviewApi) => {
    apiRef.current = api;
    const schedule = () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(persistLast, 800);
    };
    const disposables = [
      api.onDidMutateLayout(schedule),
      api.onDidAddPanel(schedule),
      api.onDidRemovePanel(schedule)
    ];
    return () => disposables.forEach(d => d.dispose());
  }, [persistLast]);

  const restoreLast = useCallback((): boolean => {
    const api = apiRef.current;
    if (!api) return false;
    try {
      const raw = localStorage.getItem(LAST_KEY);
      if (!raw) return false;
      const layout: unknown = JSON.parse(raw);
      if (!layout || typeof layout !== 'object') return false;
      api.fromJSON(layout as SerializedDockview);
      return true;
    } catch {
      return false;
    }
  }, []);

  const saveNamed = useCallback((name: string): boolean => {
    const clean = name.trim().slice(0, 48);
    if (!clean || !apiRef.current) return false;
    try {
      const store = readStore();
      store[clean] = apiRef.current.toJSON();
      localStorage.setItem(STORE_KEY, JSON.stringify(store));
      setSavedNames(Object.keys(store));
      return true;
    } catch {
      return false;
    }
  }, []);

  const restoreNamed = useCallback((name: string): boolean => {
    const api = apiRef.current;
    if (!api) return false;
    const layout: unknown = readStore()[name];
    if (!layout || typeof layout !== 'object') return false;
    try {
      api.fromJSON(layout as SerializedDockview);
      persistLast();
      return true;
    } catch {
      return false;
    }
  }, [persistLast]);

  const deleteNamed = useCallback((name: string) => {
    try {
      const store = readStore();
      delete store[name];
      localStorage.setItem(STORE_KEY, JSON.stringify(store));
      setSavedNames(Object.keys(store));
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => () => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
  }, []);

  return { attach, restoreLast, saveNamed, restoreNamed, deleteNamed, savedNames };
}
