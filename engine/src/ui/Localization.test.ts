import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  LocalizationService,
  localeChain,
  pluralCategory,
  parsePluralOptions,
  pseudoize
} from './Localization.js';

const TABLES = {
  en: {
    'shell.button.start': 'Start',
    'shell.status.won': 'Victory — {score}',
    'quest.coins': 'You have {count} {count, plural, one {coin} other {coins}}',
    'quest.lives': '{count, plural, one {# life} other {# lives}} left'
  },
  es: {
    'shell.button.start': 'Comenzar',
    'quest.coins': 'Tienes {count} {count, plural, one {moneda} other {monedas}}'
  }
};

describe('LocalizationService — tables, fallback, ICU subset', () => {
  test('direct lookup and locale switching', () => {
    const loc = new LocalizationService(TABLES, 'en');
    assert.strictEqual(loc.t('shell.button.start'), 'Start');
    loc.setLocale('es');
    assert.strictEqual(loc.t('shell.button.start'), 'Comenzar');
    assert.deepStrictEqual(loc.availableLocales(), ['en', 'es']);
  });

  test('fallback chain: region -> language -> en -> key', () => {
    const loc = new LocalizationService(TABLES, 'es-MX');
    assert.strictEqual(loc.t('shell.button.start'), 'Comenzar'); // es base
    // quest.lives missing in es -> en fallback
    assert.strictEqual(loc.t('quest.lives', { count: 1 }), '1 life left');
    // unknown everywhere -> key itself + recorded miss
    assert.strictEqual(loc.t('nope.missing'), 'nope.missing');
    assert.deepStrictEqual(loc.missingKeys(), ['nope.missing']);
    loc.clearMissing();
    assert.deepStrictEqual(loc.missingKeys(), []);
  });

  test('interpolation keeps unknown vars literal', () => {
    const loc = new LocalizationService(TABLES, 'en');
    assert.strictEqual(loc.t('shell.status.won', { score: 200 }), 'Victory — 200');
    assert.strictEqual(loc.t('shell.status.won'), 'Victory — {score}');
  });

  test('plural selection with # substitution', () => {
    const loc = new LocalizationService(TABLES, 'en');
    assert.strictEqual(loc.t('quest.coins', { count: 1 }), 'You have 1 coin');
    assert.strictEqual(loc.t('quest.coins', { count: 5 }), 'You have 5 coins');
    assert.strictEqual(loc.t('quest.lives', { count: 1 }), '1 life left');
    assert.strictEqual(loc.t('quest.lives', { count: 0 }), '0 lives left');
    loc.setLocale('es');
    assert.strictEqual(loc.t('quest.coins', { count: 1 }), 'Tienes 1 moneda');
    assert.strictEqual(loc.t('quest.coins', { count: 3 }), 'Tienes 3 monedas');
  });

  test('malformed templates never throw', () => {
    const loc = new LocalizationService({
      en: {
        unbalanced: 'You have {count, plural, one {coin}',
        noother: 'You have {count, plural, one {coin}}',
        nonnumeric: 'You have {count, plural, one {coin} other {coins}}'
      }
    });
    assert.strictEqual(loc.t('unbalanced', { count: 2 }), 'You have {count, plural, one {coin}');
    assert.strictEqual(
      loc.t('noother', { count: 2 }),
      'You have {count, plural, one {coin}}'
    );
    assert.strictEqual(
      loc.t('nonnumeric', { count: 'many' }),
      'You have {count, plural, one {coin} other {coins}}'
    );
  });

  test('pseudo-locale accents and expands', () => {
    const loc = new LocalizationService(TABLES, 'pseudo');
    const pseudo = loc.t('shell.button.start');
    assert.ok(pseudo.startsWith('⟦') && pseudo.endsWith('⟧'));
    assert.ok(pseudo.length > 'Start'.length);
    assert.ok(pseudo.includes('Š') && pseudo.includes('á'), `accents missing: ${pseudo}`);
    // Pseudo still misses unknown keys.
    assert.strictEqual(loc.t('nope.missing'), 'nope.missing');
  });

  test('localeChain and plural helpers', () => {
    assert.deepStrictEqual(localeChain('es-MX'), ['es-MX', 'es', 'en']);
    assert.deepStrictEqual(localeChain('en'), ['en']);
    assert.deepStrictEqual(localeChain('zh_Hant'), ['zh_Hant', 'zh', 'en']);
    assert.strictEqual(pluralCategory('en', 1), 'one');
    assert.strictEqual(pluralCategory('en', 5), 'other');
    assert.deepStrictEqual(parsePluralOptions('one {coin} other {coins}'), {
      one: 'coin',
      other: 'coins'
    });
    assert.ok(pseudoize('Hi').length >= 4);
  });
});
