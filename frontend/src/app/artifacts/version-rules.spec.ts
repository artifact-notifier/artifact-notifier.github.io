import { globMatches, matchesRules } from './version-rules';

describe('version rules (preview side)', () => {
  it('matches globs like the backend', () => {
    expect(globMatches('5.*', '5.3.1')).toBe(true);
    expect(globMatches('5.*', '15.0')).toBe(false);
    expect(globMatches('*-RC?', '2.0.0-rc1')).toBe(true);
    expect(globMatches('*a*a*a*a*a*a*a*b', 'a'.repeat(64))).toBe(false);
  });

  it('lets exclude rules win over include rules', () => {
    const rules = [
      { type: 'include' as const, pattern: '5.*' },
      { type: 'exclude' as const, pattern: '*-M*' },
    ];
    expect(['5.1.0', '5.2.0-M1', '6.0.0'].filter((v) => matchesRules(v, rules))).toEqual(['5.1.0']);
    expect(matchesRules('1.0', [])).toBe(true);
  });
});
