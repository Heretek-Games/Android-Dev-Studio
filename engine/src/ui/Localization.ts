/**
 * LocalizationService — key-based string tables with locale fallback,
 * ICU-subset formatting, pseudo-locale, and missing-key tracking
 * (Track 1.8, ADR-1790374704208).
 *
 * Converges on what Unity Smart Strings, Unreal FText::Format, Godot tr(),
 * i18next, and FormatJS agree on, dependency-free:
 *  - tables: { locale: { key: template } } (JSON-serializable content)
 *  - fallback chain: requested -> base language ("es-MX" -> "es") -> "en" -> key
 *  - "{var}" interpolation (unknown vars stay literal — visible, debuggable)
 *  - "{count, plural, one {...} other {...}}" via built-in Intl.PluralRules
 *    (CLDR-correct, zero dependencies); "#" substitutes the count
 *  - pseudo-locale ("pseudo"): accented + expanded text for overflow testing
 *    (Godot/Unity pseudo-localization parity)
 *  - every unresolved key is recorded (missingKeys()) for the headless
 *    locale_missing_max QA rule — never throws, never silent.
 */

export type LocaleTables = Record<string, Record<string, string>>;

const PSEUDO_MAP: Record<string, string> = {
  a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú', y: 'ý',
  A: 'Á', E: 'É', I: 'Í', O: 'Ó', U: 'Ú', Y: 'Ý',
  c: 'ç', C: 'Ç', d: 'ď', D: 'Ď', n: 'ñ', N: 'Ñ',
  s: 'š', S: 'Š', z: 'ž', Z: 'Ž', r: 'ř', R: 'Ř'
};

export class LocalizationService {
  public static readonly FALLBACK_LOCALE = 'en';
  public static readonly PSEUDO_LOCALE = 'pseudo';

  private tables: LocaleTables = {};
  private locale: string = LocalizationService.FALLBACK_LOCALE;
  private readonly missing: Set<string> = new Set();

  constructor(tables?: LocaleTables, locale?: string) {
    if (tables) this.addTables(tables);
    if (locale) this.locale = locale;
  }

  /** Merges tables (per-locale key maps) into the service. */
  public addTables(tables: LocaleTables): void {
    for (const [locale, entries] of Object.entries(tables ?? {})) {
      if (!entries || typeof entries !== 'object') continue;
      const slot = (this.tables[locale] ??= {});
      for (const [key, template] of Object.entries(entries)) {
        if (typeof template === 'string') slot[key] = template;
      }
    }
  }

  public availableLocales(): string[] {
    return Object.keys(this.tables).sort();
  }

  public setLocale(locale: string): void {
    this.locale = locale;
  }

  public getLocale(): string {
    return this.locale;
  }

  /** Keys requested but unresolved in any fallback step (audit surface). */
  public missingKeys(): string[] {
    return [...this.missing].sort();
  }

  public clearMissing(): void {
    this.missing.clear();
  }

  private lookup(key: string, locale: string): string | null {
    const chain = localeChain(locale);
    for (const candidate of chain) {
      const template = this.tables[candidate]?.[key];
      if (typeof template === 'string') return template;
    }
    return null;
  }

  /**
   * Resolves a key with optional interpolation vars and locale override.
   * Falls back through the chain; returns the key itself when unresolved
   * (and records the miss). Pseudo-locale transforms the resolved text.
   */
  public t(key: string, vars?: Record<string, unknown>, locale?: string): string {
    const active = locale ?? this.locale;
    if (active === LocalizationService.PSEUDO_LOCALE) {
      // Pseudo transforms resolved strings only: unknown keys return raw so
      // `resolved === key` miss-detection keeps working in every locale.
      const template = this.lookup(key, LocalizationService.FALLBACK_LOCALE);
      if (template === null) {
        this.missing.add(key);
        return key;
      }
      return pseudoize(this.format(template, vars));
    }
    const template = this.lookup(key, active);
    if (template === null) {
      this.missing.add(key);
      return key;
    }
    return this.format(template, vars);
  }

  private format(template: string, vars?: Record<string, unknown>): string {
    const withPlurals = this.expandPlurals(template, vars ?? {});
    return withPlurals.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name: string) => {
      const value = vars?.[name];
      return value === undefined || value === null ? match : String(value);
    });
  }

  /**
   * Expands "{count, plural, one {...} other {...}}" blocks (one nesting
   * level for option bodies, which may hold {vars} and "#").
   * Malformed blocks pass through untouched — formatting never throws.
   */
  private expandPlurals(template: string, vars: Record<string, unknown>): string {
    let out = '';
    let i = 0;
    while (i < template.length) {
      const open = template.indexOf('{', i);
      if (open === -1) {
        out += template.slice(i);
        break;
      }
      const header = /^\{([a-zA-Z0-9_]+)\s*,\s*plural\s*,/.exec(template.slice(open));
      if (!header) {
        out += template.slice(i, open + 1);
        i = open + 1;
        continue;
      }
      const varName = header[1];
      let depth = 0;
      let j = open;
      for (; j < template.length; j++) {
        if (template[j] === '{') depth++;
        else if (template[j] === '}') {
          depth--;
          if (depth === 0) break;
        }
      }
      if (j >= template.length) {
        // Unbalanced: leave the remainder literal.
        out += template.slice(i);
        break;
      }
      out += template.slice(i, open);
      const body = template.slice(open + header[0].length, j);
      const count = Number(vars[varName]);
      const options = parsePluralOptions(body);
      const fallback = options['other'];
      if (!Number.isFinite(count) || fallback === undefined) {
        out += template.slice(open, j + 1);
      } else {
        const category = pluralCategory(this.locale, count);
        const chosen = options[category] ?? options[`=${count}`] ?? fallback;
        out += chosen.split('#').join(String(count));
      }
      i = j + 1;
    }
    return out;
  }
}

/** requested -> base language -> "en" (deduplicated). */
export function localeChain(locale: string): string[] {
  const chain: string[] = [];
  const push = (candidate: string): void => {
    if (candidate && !chain.includes(candidate)) chain.push(candidate);
  };
  push(locale);
  const dash = locale.indexOf('-');
  if (dash > 0) push(locale.slice(0, dash));
  const underscore = locale.indexOf('_');
  if (underscore > 0) push(locale.slice(0, underscore));
  push(LocalizationService.FALLBACK_LOCALE);
  return chain;
}

/** CLDR plural category via the built-in Intl rules (ordinal rules excluded). */
export function pluralCategory(locale: string, count: number): string {
  try {
    return new Intl.PluralRules(locale).select(count);
  } catch {
    return count === 1 ? 'one' : 'other';
  }
}

/** Parses "one {...} other {...} =5 {...}" option bodies (single nesting). */
export function parsePluralOptions(body: string): Record<string, string> {
  const options: Record<string, string> = {};
  const pattern = /(^|\s)([a-z]+|=\d+)\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(body)) !== null) {
    const name = match[2];
    let depth = 0;
    let j = match.index + match[0].length - 1;
    for (; j < body.length; j++) {
      if (body[j] === '{') depth++;
      else if (body[j] === '}') {
        depth--;
        if (depth === 0) break;
      }
    }
    if (j >= body.length) break;
    options[name] = body.slice(match.index + match[0].length, j);
    pattern.lastIndex = j + 1;
  }
  return options;
}

/** Accented + ~40% expanded pseudo text (overflow testing). */
export function pseudoize(text: string): string {
  let out = '⟦';
  for (const ch of text) {
    if (ch === '{' || ch === '}') {
      out += ch;
      continue;
    }
    out += PSEUDO_MAP[ch] ?? ch;
  }
  const pad = Math.ceil(text.length * 0.4);
  out += '～'.repeat(Math.max(0, pad)) + '⟧';
  return out;
}
