import { ManifestResult, ParsedDependency, clean } from './model';

/** Unquotes a go.mod token ("path" or `path`). */
function token(s: string): string {
  return s.replace(/^["`](.*)["`]$/, '$1');
}

/**
 * go.mod: the direct requirements (`// indirect` ones are transitive), with the
 * exact version Go selects. A module replaced by a local directory is internal.
 */
export function parseGoMod(content: string, file: string): ManifestResult {
  const dependencies: ParsedDependency[] = [];
  const warnings: string[] = [];
  const local = new Set<string>();
  let self: string | undefined;
  let block: string | null = null;

  for (const raw of clean(content).split('\n')) {
    const indirect = /\/\/\s*indirect\b/.test(raw);
    const line = raw.replace(/\/\/.*$/, '').trim();
    if (!line) continue;
    if (block) {
      if (line === ')') block = null;
      else directive(block, line, indirect);
      continue;
    }
    const m = /^(\w+)\s*(.*)$/.exec(line);
    if (!m) continue;
    const [, verb, rest] = m;
    if (rest === '(') block = verb;
    else directive(verb, rest, indirect);
  }

  function directive(verb: string, args: string, indirect: boolean) {
    const parts = args.split(/\s+/).map(token);
    if (verb === 'module') {
      self = parts[0];
    } else if (verb === 'require' && parts.length >= 2 && !indirect) {
      dependencies.push({
        ecosystem: 'GO',
        coordinates: parts[0],
        declared: parts[1],
        version: parts[1],
        scope: 'prod',
      });
    } else if (verb === 'replace') {
      // "old [v] => new [v]": a target without version is a local directory
      const arrow = parts.indexOf('=>');
      if (arrow > 0 && parts.length === arrow + 2) local.add(parts[0]);
      else if (arrow > 0)
        warnings.push(`${file}: ${parts[0]} is replaced by ${parts[arrow + 1]}, still followed as is`);
    }
  }

  return {
    dependencies: dependencies.map((d) => (local.has(d.coordinates) ? { ...d, scope: 'module' as const } : d)),
    warnings,
    self,
  };
}
