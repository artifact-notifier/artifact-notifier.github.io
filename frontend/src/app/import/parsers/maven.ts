import { DepScope, ManifestResult, ParsedDependency, clean } from './model';

const UNRESOLVED = /\$\{[^}]*\}/;

/** Child elements by local name (pom.xml usually has a default xmlns). */
function children(el: Element | null | undefined, name: string): Element[] {
  return el ? [...el.children].filter((c) => c.localName === name) : [];
}

function child(el: Element | null | undefined, name: string): Element | undefined {
  return children(el, name)[0];
}

function text(el: Element | null | undefined, name: string): string | undefined {
  const value = child(el, name)?.textContent?.trim();
  return value || undefined;
}

function scopeOf(dep: Element): DepScope {
  if (text(dep, 'optional') === 'true') return 'optional';
  switch (text(dep, 'scope')) {
    case 'test':
      return 'test';
    case 'provided':
    case 'system':
      return 'provided';
    default:
      return 'prod';
  }
}

/** pom.xml: dependencies, parent, imported BOMs and build plugins (profiles ignored). */
export function parsePom(content: string, file: string): ManifestResult {
  const doc = new DOMParser().parseFromString(clean(content), 'application/xml');
  const project = doc.documentElement;
  if (doc.getElementsByTagName('parsererror').length || project?.localName !== 'project') {
    throw new Error('invalid pom.xml (not a Maven <project> XML document)');
  }

  const parent = child(project, 'parent');
  const props = new Map<string, string>();
  for (const p of child(project, 'properties')?.children ?? []) {
    props.set(p.localName, p.textContent?.trim() ?? '');
  }
  const projectVersion = text(project, 'version') ?? text(parent, 'version');
  const builtins: Record<string, string | undefined> = {
    'project.version': projectVersion,
    'pom.version': projectVersion,
    version: projectVersion,
    'project.groupId': text(project, 'groupId') ?? text(parent, 'groupId'),
    'project.artifactId': text(project, 'artifactId'),
    'project.parent.version': text(parent, 'version'),
    'project.parent.groupId': text(parent, 'groupId'),
  };
  for (const [k, v] of Object.entries(builtins)) if (v !== undefined && !props.has(k)) props.set(k, v);

  const resolve = (value: string | undefined): string | undefined => {
    let v = value;
    // nested properties: a few passes are enough
    for (let i = 0; v && UNRESOLVED.test(v) && i < 10; i++) {
      v = v.replace(/\$\{([^}]*)\}/g, (m, key: string) => props.get(key) ?? m);
    }
    return v;
  };

  const dependencies: ParsedDependency[] = [];
  const warnings: string[] = [];
  const add = (el: Element, scope: DepScope, defaultGroup?: string) => {
    const groupId = resolve(text(el, 'groupId') ?? defaultGroup);
    const artifactId = resolve(text(el, 'artifactId'));
    if (!groupId || !artifactId || UNRESOLVED.test(groupId) || UNRESOLVED.test(artifactId)) {
      warnings.push(`${file}: dependency ${groupId ?? '?'}:${artifactId ?? '?'} has unresolved coordinates, skipped`);
      return;
    }
    const declared = resolve(text(el, 'version'));
    const exact = declared && !UNRESOLVED.test(declared) && !/^[[(]/.test(declared);
    dependencies.push({
      ecosystem: 'MAVEN',
      coordinates: `${groupId}:${artifactId}`,
      ...(declared ? { declared } : {}),
      ...(exact ? { version: declared } : {}),
      scope,
    });
  };

  if (parent) add(parent, 'parent');
  for (const dep of children(child(project, 'dependencies'), 'dependency')) add(dep, scopeOf(dep));
  for (const dep of children(child(child(project, 'dependencyManagement'), 'dependencies'), 'dependency')) {
    // only imported BOMs: the other managed entries are versions, not dependencies
    if (text(dep, 'scope') === 'import' && (text(dep, 'type') ?? 'jar') === 'pom') add(dep, 'bom');
  }
  for (const plugin of children(child(child(project, 'build'), 'plugins'), 'plugin')) {
    add(plugin, 'plugin', 'org.apache.maven.plugins');
  }
  return { dependencies, warnings };
}
