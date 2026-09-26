import { test, describe } from 'node:test';
import assert from 'node:assert';
import { Quest, type QuestProgress } from './Quest.js';

function progress(overrides: Partial<QuestProgress> = {}): QuestProgress {
  return { flags: [], kills: 0, reactions: 0, phase: 'active', ...overrides };
}

function chain(): Quest {
  return new Quest({
    id: 'blessing',
    stages: [
      { id: 'audience', objectives: [{ id: 'meet', kind: 'flag', target: 'met_keeper' }] },
      {
        id: 'blessing',
        objectives: [{ id: 'blessed', kind: 'flag', target: 'hydro_blessing' }]
      },
      {
        id: 'clear',
        objectives: [
          { id: 'slay', kind: 'kills', target: 'any', count: 3 },
          { id: 'react', kind: 'reactions', target: 'any', count: 2 }
        ]
      },
      { id: 'victory', objectives: [{ id: 'won', kind: 'phase', target: 'won' }] }
    ]
  });
}

describe('Quest — ordered stage tracker', () => {
  test('stages complete in order, one per update', () => {
    const quest = chain();
    const seen: string[] = [];
    quest.onStage(id => seen.push(id));
    assert.strictEqual(quest.update(progress()), null);
    assert.strictEqual(quest.update(progress({ flags: ['met_keeper', 'hydro_blessing'] })), 'audience');
    assert.strictEqual(quest.stageIndex, 1); // blessing waits for the next update
    assert.strictEqual(quest.update(progress({ flags: ['met_keeper', 'hydro_blessing'] })), 'blessing');
    assert.deepStrictEqual(seen, ['audience', 'blessing']);
  });

  test('kill/reaction counts gate the combat stage', () => {
    const quest = chain();
    quest.update(progress({ flags: ['met_keeper'] }));
    quest.update(progress({ flags: ['met_keeper', 'hydro_blessing'] }));
    assert.strictEqual(quest.update(progress({ kills: 3, reactions: 1 })), null);
    assert.strictEqual(quest.update(progress({ kills: 3, reactions: 2 })), 'clear');
  });

  test('phase objective and completion event close the chain', () => {
    const quest = chain();
    let completed = 0;
    quest.onComplete(() => completed++);
    for (const p of [
      progress({ flags: ['met_keeper'] }),
      progress({ flags: ['met_keeper', 'hydro_blessing'] }),
      progress({ kills: 9, reactions: 9 }),
      progress({ kills: 9, reactions: 9, phase: 'won' })
    ]) {
      quest.update(p);
    }
    assert.strictEqual(quest.complete, true);
    assert.strictEqual(completed, 1);
    assert.strictEqual(quest.update(progress({ phase: 'won' })), null); // terminal
  });

  test('stage-kind objectives reference earlier stages, unknown kinds fail shut', () => {
    const quest = new Quest({
      id: 'epilogue',
      stages: [
        { id: 'first', objectives: [{ id: 'f', kind: 'flag', target: 'a' }] },
        { id: 'second', objectives: [{ id: 's', kind: 'stage', target: 'first' }] },
        { id: 'bogus', objectives: [{ id: 'b', kind: 'mystery' as never, target: 'x' }] }
      ]
    });
    quest.update(progress({ flags: ['a'] }));
    assert.strictEqual(quest.update(progress({ flags: ['a'] })), 'second');
    assert.strictEqual(quest.update(progress({ flags: ['a'] })), null); // bogus never met
    assert.strictEqual(quest.complete, false);
  });

  test('JSON round-trips mid-chain progress for SaveSystem', () => {
    const quest = chain();
    quest.update(progress({ flags: ['met_keeper'] }));
    const restored = Quest.fromJSON(JSON.parse(JSON.stringify(quest.toJSON())));
    assert.deepStrictEqual(restored.completedStageIds, ['audience']);
    assert.strictEqual(restored.stageIndex, 1);
    assert.strictEqual(restored.update(progress({ flags: ['met_keeper', 'hydro_blessing'] })), 'blessing');
  });
});
