import { globMatches, matchesRules, parseRules, serializeRules } from './version-rules';

describe('globMatches', () => {
  it.each([
    ['5.*', '5.3.1', true],
    ['5.*', '6.0.0', false],
    ['5.*', '15.0', false],
    ['*-rc*', '2.0.0-RC1', true],
    ['*-rc*', '2.0.0', false],
    ['2.1?.*', '2.13.4', true],
    ['2.1?.*', '2.1.4', false],
    ['1.0', '1.0', true],
    ['1.0', '1.0.1', false],
    ['*', 'anything', true],
    ['**.*', '1.2', true],
  ])('%s vs %s -> %s', (pattern, version, expected) => {
    expect(globMatches(pattern, version)).toBe(expected);
  });

  it('stays fast on patterns built to backtrack', () => {
    const start = Date.now();
    expect(globMatches('*a*a*a*a*a*a*a*a*a*a*b', 'a'.repeat(64))).toBe(false);
    expect(Date.now() - start).toBeLessThan(50);
  });
});

describe('matchesRules', () => {
  it('lets everything through without rules', () => {
    expect(matchesRules('1.0', [])).toBe(true);
  });

  it('requires one include rule to match when there are some', () => {
    const rules = [
      { type: 'include' as const, pattern: '5.*' },
      { type: 'include' as const, pattern: '6.1.*' },
    ];
    expect(['5.3.0', '6.1.2', '6.2.0'].filter((v) => matchesRules(v, rules))).toEqual(['5.3.0', '6.1.2']);
  });

  it('gives exclude rules the last word', () => {
    const rules = [
      { type: 'include' as const, pattern: '5.*' },
      { type: 'exclude' as const, pattern: '*-M*' },
    ];
    expect(['5.3.0', '5.4.0-M1', '6.0.0'].filter((v) => matchesRules(v, rules))).toEqual(['5.3.0']);
  });
});

describe('rules column', () => {
  it('round-trips and drops what it cannot read', () => {
    const rules = [{ type: 'exclude' as const, pattern: '*-rc*' }];
    expect(parseRules(serializeRules(rules))).toEqual(rules);
    expect(serializeRules([])).toBeNull();
    expect(parseRules(null)).toEqual([]);
    expect(parseRules('not json')).toEqual([]);
    expect(parseRules('[{"type":"other","pattern":"x"},{"type":"include"}]')).toEqual([]);
  });
});
