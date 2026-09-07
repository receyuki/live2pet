import { describe, expect, it } from 'vitest';
import { messages, translateBehavior } from './i18n';

const placeholders = (value: string) => [...value.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]).sort();

describe('i18n catalog', () => {
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
