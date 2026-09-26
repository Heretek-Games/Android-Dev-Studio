import { test, describe } from 'node:test';
import assert from 'node:assert';
import { Telemetry } from './Telemetry.js';
import { CrashReportCollector, scrubPii } from './CrashReport.js';
import { RemoteConfig } from './RemoteConfig.js';

describe('Telemetry — opt-in events, kids mode, PII drops', () => {
  test('disabled by default; records when enabled', () => {
    const off = new Telemetry();
    assert.strictEqual(off.record('jump'), false);
    assert.strictEqual(off.droppedDisabled, 1);
    const on = new Telemetry({ enabled: true, build: '1.2.3' });
    assert.strictEqual(on.record('jump', { height: 2.5, style: 'spin' }), true);
    assert.strictEqual(on.queuedEvents, 1);
    assert.strictEqual(on.countOf('jump'), 1);
    assert.strictEqual(on.countOf('land'), 0);
  });

  test('kids mode keeps diagnostics, drops behavioral', () => {
    const t = new Telemetry({ enabled: true, kidsMode: true });
    assert.strictEqual(t.record('level_complete', { score: 9 }), false);
    assert.strictEqual(t.record('error', { code: 500 }), true);
    assert.strictEqual(t.droppedKids, 1);
  });

  test('PII keys dropped and counted; non-finite numbers zeroed', () => {
    const t = new Telemetry({ enabled: true });
    t.record('signup', { email: 'a@b.com', nick: 'hero', score: NaN });
    assert.strictEqual(t.droppedPii, 1);
    assert.strictEqual(t.countOf('signup'), 1);
    const summary = t.summarize();
    assert.strictEqual(summary['signup'].count, 1);
    assert.strictEqual(summary['signup'].means['score'], 0);
  });

  test('queue caps, flush spools offline, summary aggregates', () => {
    const t = new Telemetry({ enabled: true, maxEvents: 3 });
    for (let i = 0; i < 5; i++) t.record('tick', { i });
    assert.strictEqual(t.queuedEvents, 3);
    assert.strictEqual(t.countOf('tick'), 3);
    assert.strictEqual(t.summarize()['tick'].means['i'], 3);
    let sent: unknown[] | null = null;
    assert.strictEqual(t.flush({ send: () => false }), false);
    assert.strictEqual(t.queuedEvents, 3);
    assert.strictEqual(t.flush({ send: batch => { sent = batch; return true; } }), true);
    assert.strictEqual(t.queuedEvents, 0);
    assert.strictEqual(sent!.length, 3);
  });

  test('logical clock ticks deterministically; round-trips', () => {
    const t = new Telemetry({ enabled: true, sessionId: 's-1' });
    t.tick(0.5);
    t.record('a');
    t.tick(0.5);
    t.record('b');
    const json = t.toJSON();
    assert.strictEqual(json.type, 'Telemetry');
    const other = new Telemetry();
    other.fromJSON(JSON.parse(JSON.stringify(json)));
    assert.strictEqual(other.queuedEvents, 2);
    assert.strictEqual(other.countOf('a'), 1);
    assert.strictEqual(other.sessionId, 's-1');
  });
});

describe('CrashReportCollector — scrub, spool, flush', () => {
  test('scrubPii redacts emails, home paths, and tokens', () => {
    const { text, redactions } = scrubPii(
      'user a@b.com failed at /home/john/game/main.js with sk-abc123XYZ token'
    );
    assert.ok(!text.includes('a@b.com'));
    assert.ok(!text.includes('/home/john'));
    assert.ok(!text.includes('sk-abc123XYZ'));
    assert.strictEqual(redactions, 3);
    assert.ok(text.includes('[email]'));
  });

  test('capture disabled by default; breadcrumbs bound reports', () => {
    const c = new CrashReportCollector();
    assert.strictEqual(c.captureException(new Error('x')), null);
    c.enabled = true;
    c.leaveBreadcrumb('scene: arena');
    c.leaveBreadcrumb('wave: 3');
    const report = c.captureException(new Error('boom at /home/john/x.js'), { wave: 3 })!;
    assert.ok(report, 'captured');
    assert.deepStrictEqual(report.breadcrumbs, ['scene: arena', 'wave: 3']);
    assert.ok(!report.stack?.includes('/home/john'));
    assert.strictEqual(report.context['wave'], '3');
    assert.strictEqual(c.spooledReports, 1);
  });

  test('spool caps and survives failed flushes', () => {
    const c = new CrashReportCollector({ enabled: true, spoolCap: 2 });
    c.captureException('one');
    c.captureException('two');
    c.captureException('three');
    assert.strictEqual(c.spooledReports, 2);
    assert.strictEqual(c.flush({ send: () => false }), false);
    assert.strictEqual(c.spooledReports, 2);
    const sent: string[] = [];
    assert.strictEqual(c.flush({ send: r => { sent.push(r.id); return true; } }), true);
    assert.strictEqual(c.spooledReports, 0);
    assert.strictEqual(sent.length, 2);
  });

  test('breadcrumb ring caps; round-trips', () => {
    const c = new CrashReportCollector({ enabled: true, breadcrumbCap: 3 });
    for (let i = 0; i < 5; i++) c.leaveBreadcrumb(`b${i}`);
    assert.strictEqual(c.breadcrumbCount, 3);
    const json = c.toJSON();
    assert.strictEqual(json.type, 'CrashReportCollector');
    const other = new CrashReportCollector();
    other.fromJSON(JSON.parse(JSON.stringify(json)));
    assert.strictEqual(other.breadcrumbCount, 3);
  });
});

describe('RemoteConfig — defaults, fetch/activate, cohorts', () => {
  test('defaults win offline; fetch stages, activate applies', async () => {
    const rc = new RemoteConfig({ defaults: { doubleXp: false, enemySpeed: 1.0 }, build: 12 });
    assert.strictEqual(rc.getBool('doubleXp'), false);
    assert.strictEqual(rc.getNumber('enemySpeed'), 1.0);
    assert.strictEqual(rc.getString('missing', 'fallback'), 'fallback');
    assert.strictEqual(await rc.fetch(async () => ({ doubleXp: true })), true);
    assert.strictEqual(rc.getBool('doubleXp'), false); // staged, not active
    assert.strictEqual(rc.hasStaged, true);
    assert.strictEqual(rc.activate(), true);
    assert.strictEqual(rc.getBool('doubleXp'), true);
    assert.strictEqual(rc.activate(), false); // nothing staged
    assert.strictEqual(await rc.fetch(async () => { throw new Error('offline'); }), false);
  });

  test('kill-switch pattern and coercions', () => {
    const rc = new RemoteConfig({ defaults: { eventLive: true, bossHp: 500 } });
    assert.strictEqual(rc.getBool('eventLive'), true);
    rc.fromJSON({ defaults: { eventLive: true }, active: { eventLive: false } });
    assert.strictEqual(rc.getBool('eventLive'), false);
    assert.strictEqual(rc.getNumber('bossHp', 100), 100); // restore replaces defaults
    assert.strictEqual(rc.getNumber('eventLive', 7), 7); // bool is not numeric
  });

  test('cohort gating is deterministic per install', () => {
    const a = new RemoteConfig({ installId: 'fixed-id', build: 10 });
    const b = new RemoteConfig({ installId: 'fixed-id', build: 10 });
    assert.strictEqual(a.gated('event', 50), b.gated('event', 50));
    assert.strictEqual(a.gated('event', 0), false);
    assert.strictEqual(a.gated('event', 100), true);
    assert.strictEqual(a.gated('event', 50, 99), false); // build floor
    // Distribution sanity: ~half of 200 installs roll in at 50%.
    let hits = 0;
    for (let i = 0; i < 200; i++) {
      if (new RemoteConfig({ installId: `id-${i}` }).gated('event', 50)) hits++;
    }
    assert.ok(hits > 70 && hits < 130, `hits=${hits}`);
  });

  test('serialization preserves install, build, and layers', () => {
    const rc = new RemoteConfig({ defaults: { a: 1 }, installId: 'keep-me', build: 3 });
    const json = rc.toJSON();
    assert.strictEqual(json.type, 'RemoteConfig');
    const other = new RemoteConfig();
    other.fromJSON(JSON.parse(JSON.stringify(json)));
    assert.strictEqual(other.installId, 'keep-me');
    assert.strictEqual(other.getNumber('a'), 1);
  });
});
