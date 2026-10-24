import { digestHeading, groupByProject, indexProjects } from './digest';

const rxjs = { ecosystem: 'NPM', coordinates: 'rxjs', version: '7.9.0' };
const boot = { ecosystem: 'MAVEN', coordinates: 'org.springframework.boot:spring-boot', version: '4.1.3' };
const react = { ecosystem: 'NPM', coordinates: 'react', version: '20.0.0' };

const projects = indexProjects([
  { ecosystem: 'NPM', project: { name: 'shop' }, dependencies: [{ coordinates: 'rxjs' }] },
  { ecosystem: 'NPM', project: { name: 'admin' }, dependencies: [{ coordinates: 'rxjs' }] },
  // a second source of the same project does not list it twice
  { ecosystem: 'NPM', project: { name: 'shop' }, dependencies: [{ coordinates: 'rxjs' }] },
  {
    ecosystem: 'MAVEN',
    project: { name: 'shop' },
    dependencies: [{ coordinates: 'org.springframework.boot:spring-boot' }],
  },
]);

describe('groupByProject', () => {
  it('lists each version under every project using it, projects sorted, then the rest', () => {
    expect(groupByProject([rxjs, boot, react], projects)).toEqual([
      { project: 'admin', items: [rxjs] },
      { project: 'shop', items: [rxjs, boot] },
      { project: null, items: [react] },
    ]);
  });

  it('keeps a single group without projects', () => {
    expect(groupByProject([react], new Map())).toEqual([{ project: null, items: [react] }]);
  });

  it('matches the ecosystem too', () => {
    expect(groupByProject([{ ...rxjs, ecosystem: 'PYPI' }], projects)).toEqual([
      { project: null, items: [{ ...rxjs, ecosystem: 'PYPI' }] },
    ]);
  });
});

describe('digestHeading', () => {
  it('titles projects, and the rest only when there are projects', () => {
    const groups = groupByProject([rxjs, react], projects);
    expect(groups.map((g) => digestHeading(g, groups, 'fr'))).toEqual(['📁 admin', '📁 shop', 'Hors projet']);
    const single = groupByProject([react], projects);
    expect(digestHeading(single[0], single, 'fr')).toBeNull();
  });
});
