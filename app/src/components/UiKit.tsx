import React from 'react';

/**
 * Shared studio component kit (Track D.1): buttons, badges, section headers,
 * and empty/error states on `studio.*` Tailwind tokens. New chrome uses these;
 * existing docks migrate opportunistically (token audit tracks progress).
 */

export const KitButton: React.FC<{
  children: React.ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'ghost' | 'danger';
  title?: string;
  disabled?: boolean;
}> = ({ children, onClick, variant = 'ghost', title, disabled }) => {
  const styles =
    variant === 'primary'
      ? 'bg-blue-600 hover:bg-blue-500 text-white'
      : variant === 'danger'
        ? 'bg-red-600/20 hover:bg-red-600/30 text-red-200 border border-red-500/40'
        : 'text-gray-300 hover:bg-studio-hover border border-studio-border/60';
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors disabled:opacity-50 ${styles}`}
    >
      {children}
    </button>
  );
};

export const KitBadge: React.FC<{ children: React.ReactNode; tone?: 'info' | 'ok' | 'warn' | 'bad' }> = ({
  children,
  tone = 'info'
}) => {
  const tones = {
    info: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
    ok: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
    warn: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
    bad: 'bg-red-500/20 text-red-300 border-red-500/30'
  };
  return (
    <span className={`text-[11px] px-2 py-0.5 rounded border font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
};

export const KitSectionHeader: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider block">
    {children}
  </span>
);

export const KitEmptyState: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="px-4 py-6 text-center text-xs text-zinc-500">{children}</div>
);

export const KitErrorState: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="px-3 py-2 rounded-md bg-red-500/10 border border-red-500/30 text-[11px] text-red-300 font-mono">
    {children}
  </div>
);
