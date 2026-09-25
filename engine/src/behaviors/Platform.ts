import { Component } from '../core/Component.js';

export type PlatformType = 'solid' | 'jumpthru' | 'ladder';

export interface PlatformOptions {
  platformType?: PlatformType;
}

/**
 * Platform marker behavior (Track 1.3 behavior library, GDevelop-informed).
 *
 * Tags solid ground, one-way jumpthru floors, and climbable ladders for
 * PlatformerCharacter resolution. No per-frame work.
 */
export class Platform extends Component {
  public platformType: PlatformType = 'solid';

  constructor(options?: PlatformOptions) {
    super();
    if (options?.platformType !== undefined) this.platformType = options.platformType;
  }

  public override toJSON(): Record<string, any> {
    return { type: 'Platform', enabled: this.enabled, platformType: this.platformType };
  }

  public override fromJSON(data: Record<string, any>): void {
    if (data.enabled !== undefined) this.enabled = data.enabled;
    if (data.platformType !== undefined) this.platformType = data.platformType;
  }
}
