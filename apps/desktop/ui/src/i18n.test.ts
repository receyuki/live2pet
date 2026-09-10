import { describe, expect, it } from 'vitest';
import { localeFromSystemLanguage, messages, resolveInitialLocale, translateBehavior } from './i18n';

const placeholders = (value: string) => [...value.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]).sort();

describe('i18n catalog', () => {
  it.each([
    ['zh-CN', 'zh-CN'],
    ['zh-Hans-CN', 'zh-CN'],
    ['zh_SG', 'zh-CN'],
    ['zh-Hant', 'en'],
    ['zh-TW', 'en'],
    ['ja-JP', 'en'],
    [undefined, 'en'],
  ] as const)('matches supported system language %s to %s', (language, expected) => {
    expect(localeFromSystemLanguage(language)).toBe(expected);
  });

  it('uses a saved user language before the system language', () => {
    expect(resolveInitialLocale({ getItem: () => 'en' }, 'zh-CN')).toBe('en');
    expect(resolveInitialLocale({ getItem: () => 'zh-CN' }, 'en-US')).toBe('zh-CN');
    expect(resolveInitialLocale({ getItem: () => null }, 'zh-Hans')).toBe('zh-CN');
  });

  it('keeps English and Simplified Chinese keys and placeholders aligned', () => {
    expect(Object.keys(messages['zh-CN']).sort()).toEqual(Object.keys(messages.en).sort());
    for (const key of Object.keys(messages.en) as Array<keyof typeof messages.en>) {
      expect(placeholders(messages['zh-CN'][key]), key).toEqual(placeholders(messages.en[key]));
    }
  });

  it('does not leave internal prototype terminology in Chinese copy', () => {
    const obsoleteTerms = /\b(?:runtime|mapper|build service|Source|Map|Build|Welcome|Settings)\b/;
    for (const [key, value] of Object.entries(messages['zh-CN'])) expect(value, key).not.toMatch(obsoleteTerms);
  });

  it('localizes every target behavior shown in mapping and build readiness', () => {
    const ids = [
      'idle', 'thinking', 'working', 'sleeping', 'error', 'attention', 'notification', 'sweeping', 'carrying', 'juggling', 'roam',
      'yawning', 'dozing', 'collapsing', 'waking', 'drag', 'clickLeft', 'clickRight', 'annoyed', 'double',
      'running-right', 'running-left', 'waving', 'jumping', 'failed', 'waiting', 'running', 'review',
    ];
    for (const id of ids) expect(translateBehavior('zh-CN', id), id).not.toBe(id);
  });
});
