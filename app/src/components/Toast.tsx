import React from 'react';
import { useStudio } from '../state/StudioState';

/**
 * Non-destructive toast (Track D.2): surfaces external scene changes with an
 * optional action (Reload). Never auto-applies over local edits — the dirty
 * tree gets Reload/Keep instead of a silent overwrite.
 */
export const Toast: React.FC = () => {
  const { toast, dismissToast, dismissExternal, pendingExternalRev } = useStudio();
  if (!toast) return null;
  return (
    <div
      data-testid="studio-toast"
      className="absolute bottom-8 left-1/2 -translate-x-1/2 z-[90] flex items-center space-x-3 px-4 py-2 rounded-lg bg-studio-surface border border-studio-border shadow-2xl text-xs text-studio-text max-w-[560px]"
    >
      <span className="truncate">{toast.msg}</span>
      {toast.action && (
        <button
          onClick={() => { dismissToast(); toast.action!.run(); }}
          className="shrink-0 px-2.5 py-1 rounded bg-studio-accent hover:opacity-90 text-white text-[11px] font-semibold transition-colors"
        >
          {toast.action.label}
        </button>
      )}
      {pendingExternalRev !== null && (
        <button
          onClick={dismissExternal}
          className="shrink-0 px-2.5 py-1 rounded border border-studio-border text-studio-muted hover:bg-studio-hover text-[11px] transition-colors"
        >
          Keep mine
        </button>
      )}
      <button
        onClick={dismissToast}
        className="shrink-0 text-studio-faint hover:text-studio-text text-sm leading-none"
        title="Dismiss"
      >
        ×
      </button>
    </div>
  );
};
