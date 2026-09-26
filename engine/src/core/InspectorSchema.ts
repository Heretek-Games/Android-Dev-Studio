/**
 * InspectorSchema — explicit per-type property tables driving the studio
 * Inspector (Track C.1, ADR-1790393500001).
 *
 * Godot `_get_property_list` pattern adapted: each component type declares its
 * inspectable fields as data. Keys are EXPLICIT strings (never
 * `constructor.name` / decorator metadata), so schemas survive minification.
 * Component modules self-register on import, mirroring ComponentRegistry.
 */

export type InspectorFieldKind =
  | 'number'
  | 'slider'
  | 'boolean'
  | 'color'
  | 'text'
  | 'enum'
  | 'vec3';

export interface InspectorField {
  /** Stable property key on the component instance. */
  key: string;
  label?: string;
  kind: InspectorFieldKind;
  min?: number;
  max?: number;
  step?: number;
  /** Allowed values for `enum` fields. */
  options?: string[];
  /** Visual grouping header. */
  group?: string;
}

const schemas = new Map<string, InspectorField[]>();

/** Register a schema under an explicit type string (minification-safe). */
export function registerInspectorSchema(type: string, fields: InspectorField[]): void {
  schemas.set(type, [...fields]);
}

/** Schema for an explicit type string, or null when unregistered. */
export function getInspectorSchema(type: string): InspectorField[] | null {
  const fields = schemas.get(type);
  return fields ? [...fields] : null;
}

export function registeredSchemaTypes(): string[] {
  return [...schemas.keys()].sort();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function coerceNumber(value: unknown, field: InspectorField): number | null {
  const num = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof num !== 'number' || !Number.isFinite(num)) return null;
  let out = num;
  if (field.min !== undefined) out = Math.max(field.min, out);
  if (field.max !== undefined) out = Math.min(field.max, out);
  return out;
}

/** Read a schema field from a component instance (null when unreadable). */
export function readInspectorField(component: unknown, field: InspectorField): unknown {
  if (!isRecord(component)) return null;
  const value = component[field.key];
  if (field.kind === 'vec3') {
    if (!Array.isArray(value) || value.length !== 3) return null;
    return value;
  }
  return value ?? null;
}

export interface InspectorWriteResult {
  ok: boolean;
  error?: string;
}

/** Validate + write a schema field (numbers clamp, enums/colors strict). */
export function writeInspectorField(
  component: unknown,
  field: InspectorField,
  value: unknown
): InspectorWriteResult {
  if (!isRecord(component)) return { ok: false, error: 'not an object' };
  switch (field.kind) {
    case 'number':
    case 'slider': {
      const num = coerceNumber(value, field);
      if (num === null) return { ok: false, error: `${field.key} must be a finite number` };
      component[field.key] = num;
      return { ok: true };
    }
    case 'boolean': {
      if (typeof value !== 'boolean') return { ok: false, error: `${field.key} must be a boolean` };
      component[field.key] = value;
      return { ok: true };
    }
    case 'color':
    case 'text': {
      if (typeof value !== 'string') return { ok: false, error: `${field.key} must be a string` };
      if (field.kind === 'color' && !/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(value)) {
        return { ok: false, error: `${field.key} must be #rgb/#rrggbb` };
      }
      component[field.key] = value;
      return { ok: true };
    }
    case 'enum': {
      if (typeof value !== 'string' || !(field.options ?? []).includes(value)) {
        return { ok: false, error: `${field.key} must be one of ${(field.options ?? []).join('|')}` };
      }
      component[field.key] = value;
      return { ok: true };
    }
    case 'vec3': {
      if (!Array.isArray(value) || value.length !== 3) {
        return { ok: false, error: `${field.key} must be [x, y, z]` };
      }
      const nums = value.map(v => coerceNumber(v, { key: field.key, kind: 'number' }));
      if (nums.some(n => n === null)) return { ok: false, error: `${field.key} must hold finite numbers` };
      component[field.key] = nums as [number, number, number];
      return { ok: true };
    }
  }
}
