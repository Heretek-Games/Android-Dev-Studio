import { test, describe } from 'node:test';
import assert from 'node:assert';
import { WebAudioBackend } from './WebAudioBackend.js';

describe('WebAudioBackend — browser guards', () => {
  test('isSupported() is false in a headless runtime', () => {
    assert.strictEqual(WebAudioBackend.isSupported(), false);
  });

  test('constructing without an AudioContext throws a clear error', () => {
    assert.throws(() => new WebAudioBackend(), /AudioContext/);
  });
});
