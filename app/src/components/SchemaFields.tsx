import React from 'react';
import {
  getInspectorSchema,
  readInspectorField,
  writeInspectorField,
  type InspectorField
} from '@heretek/engine';

/**
 * SchemaFields — schema-driven property editors (Track C.1 spike).
 *
 * Renders an engine InspectorSchema table as labeled inputs. Writes go
 * through writeInspectorField (validated/coerced); the caller repaints via
 * onCommit. New components need zero Inspector.tsx edits once registered.
 */

function FieldInput({
  component,
  field,
  onCommit
}: {
  component: object;
  field: InspectorField;
  onCommit: () => void;
}) {
  const value = readInspectorField(component, field);
  const commit = (next: unknown) => {
    const result = writeInspectorField(component, field, next);
    if (result.ok) onCommit();
  };

  switch (field.kind) {
    case 'slider':
      return (
        <div className="space-y-1">
          <div className="flex justify-between text-zinc-400">
            <span>{field.label ?? field.key}</span>
            <span className="font-mono text-zinc-200">{String(value ?? '')}</span>
          </div>
          <input
            type="range"
            min={field.min ?? 0}
            max={field.max ?? 100}
            step={field.step ?? 1}
            value={typeof value === 'number' ? value : 0}
            onChange={e => commit(parseFloat(e.target.value))}
            className="w-full accent-amber-500 cursor-pointer h-1.5 bg-zinc-800 rounded"
          />
        </div>
      );
    case 'number':
      return (
        <div className="flex items-center justify-between">
          <span className="text-zinc-400">{field.label ?? field.key}</span>
          <input
            type="number"
            step={field.step ?? 1}
            value={typeof value === 'number' ? value : 0}
            onChange={e => commit(parseFloat(e.target.value))}
            className="w-20 bg-zinc-950 border border-zinc-700 rounded px-2 py-0.5 text-right text-white outline-none font-mono"
          />
        </div>
      );
    case 'boolean':
      return (
        <label className="flex items-center justify-between cursor-pointer">
          <span className="text-zinc-400">{field.label ?? field.key}</span>
          <input
            type="checkbox"
            checked={value === true}
            onChange={e => commit(e.target.checked)}
            className="accent-amber-500 w-4 h-4 cursor-pointer"
          />
        </label>
      );
    case 'color':
      return (
        <div className="flex items-center justify-between">
          <span className="text-zinc-400">{field.label ?? field.key}</span>
          <input
            type="color"
            value={typeof value === 'string' ? value : '#ffffff'}
            onChange={e => commit(e.target.value)}
            className="w-10 h-6 bg-zinc-950 border border-zinc-700 rounded cursor-pointer"
          />
        </div>
      );
    case 'enum':
      return (
        <div className="flex items-center justify-between">
          <span className="text-zinc-400">{field.label ?? field.key}</span>
          <select
            value={typeof value === 'string' ? value : ''}
            onChange={e => commit(e.target.value)}
            className="bg-zinc-850 text-zinc-200 border border-zinc-700 rounded px-2 py-0.5 outline-none cursor-pointer"
          >
            {(field.options ?? []).map(opt => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </div>
      );
    case 'text':
      return (
        <div className="flex items-center justify-between">
          <span className="text-zinc-400">{field.label ?? field.key}</span>
          <input
            type="text"
            value={typeof value === 'string' ? value : ''}
            onChange={e => commit(e.target.value)}
            className="w-32 bg-zinc-950 border border-zinc-700 rounded px-2 py-0.5 text-right text-white outline-none font-mono"
          />
        </div>
      );
    case 'vec3': {
      const arr = Array.isArray(value) ? value : [0, 0, 0];
      return (
        <div className="space-y-1">
          <span className="text-zinc-400">{field.label ?? field.key}</span>
          <div className="grid grid-cols-3 gap-1">
            {(['X', 'Y', 'Z'] as const).map((axis, i) => (
              <input
                key={axis}
                type="number"
                step={field.step ?? 0.1}
                value={typeof arr[i] === 'number' ? arr[i] : 0}
                onChange={e => {
                  const next = [...arr];
                  next[i] = parseFloat(e.target.value);
                  commit(next);
                }}
                className="bg-zinc-950 border border-zinc-700 rounded px-1 py-0.5 text-right text-white outline-none font-mono"
              />
            ))}
          </div>
        </div>
      );
    }
  }
}

export const SchemaFields: React.FC<{
  type: string;
  component: object;
  onCommit: () => void;
}> = ({ type, component, onCommit }) => {
  const schema = getInspectorSchema(type);
  if (!schema) return null;
  const sections: Array<{ group?: string; fields: InspectorField[] }> = [];
  for (const field of schema) {
    const last = sections[sections.length - 1];
    if (last && last.group === field.group) last.fields.push(field);
    else sections.push({ group: field.group, fields: [field] });
  }
  return (
    <div className="space-y-2 text-xs" data-schema-type={type}>
      {sections.map((section, i) => (
        <React.Fragment key={section.group ?? `ungrouped-${i}`}>
          {section.group && (
            <div className="pt-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              {section.group}
            </div>
          )}
          {section.fields.map(field => (
            <FieldInput key={field.key} component={component} field={field} onCommit={onCommit} />
          ))}
        </React.Fragment>
      ))}
    </div>
  );
};
