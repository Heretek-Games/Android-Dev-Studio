import type { Component } from './Component.js';

/**
 * Component type registry for deserialization (Track 1.2 undo/redo).
 *
 * Maps `Component.toJSON().type` strings (constructor names) back to
 * constructors so `GameObject.fromJSON` can rebuild live objects. Component
 * modules self-register on import; unknown types fail loudly at restore
 * time instead of silently dropping behavior.
 */

type ComponentCtor = new (...args: never[]) => Component;

const registry = new Map<string, ComponentCtor>();

export function registerComponent(type: string, ctor: ComponentCtor): void {
  registry.set(type, ctor);
}

export function createComponent(type: string): Component | null {
  const ctor = registry.get(type);
  return ctor ? new ctor() : null;
}

export function registeredComponentTypes(): string[] {
  return [...registry.keys()].sort();
}
