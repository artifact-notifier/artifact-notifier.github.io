import { collectFromDataTransfer, collectFromFileList } from './collect-files';

const accept = (path: string) => /(^|\/)(package\.json|pom\.xml)$/.test(path);

function file(name: string, content: string, relativePath = '') {
  const f = new File([content], name);
  Object.defineProperty(f, 'webkitRelativePath', { value: relativePath });
  return f;
}

/** Minimal FileSystemEntry tree for drop events. */
function fileEntry(name: string, content: string): FileSystemEntry {
  return { isFile: true, isDirectory: false, name, file: (ok: (f: File) => void) => ok(file(name, content)) } as any;
}
function dirEntry(name: string, children: FileSystemEntry[]): FileSystemEntry {
  return {
    isFile: false,
    isDirectory: true,
    name,
    createReader: () => {
      let done = false;
      // like browsers: entries in a batch, then an empty batch
      return { readEntries: (ok: (e: FileSystemEntry[]) => void) => ok(done ? [] : ((done = true), children)) };
    },
  } as any;
}
function dataTransfer(entries: FileSystemEntry[], files: File[] = []): DataTransfer {
  return {
    items: entries.map((e) => ({ kind: 'file', webkitGetAsEntry: () => e })),
    files,
  } as unknown as DataTransfer;
}

describe('collectFromFileList', () => {
  it('keeps supported files with their folder path, skipping dependency folders', async () => {
    const res = await collectFromFileList(
      [
        file('package.json', '{"a":1}', 'repo/front/package.json'),
        file('package.json', '{}', 'repo/node_modules/x/package.json'),
        file('README.md', '#', 'repo/README.md'),
        file('pom.xml', '<project/>'),
      ],
      accept,
    );
    expect(res.files).toEqual([
      { path: 'repo/front/package.json', content: '{"a":1}' },
      { path: 'pom.xml', content: '<project/>' },
    ]);
    expect(res.skipped).toEqual([]);
  });

  it('skips files that are too large', async () => {
    const big = file('package.json', 'x');
    Object.defineProperty(big, 'size', { value: 6 * 1024 * 1024 });
    const res = await collectFromFileList([big], accept);
    expect(res.files).toEqual([]);
    expect(res.skipped).toEqual(['package.json']);
  });
});

describe('collectFromDataTransfer', () => {
  it('walks dropped folders, ignoring node_modules, target and unsupported files', async () => {
    const tree = dirEntry('repo', [
      dirEntry('front', [fileEntry('package.json', '{}'), dirEntry('node_modules', [fileEntry('package.json', 'no')])]),
      dirEntry('back', [fileEntry('pom.xml', '<project/>'), dirEntry('target', [fileEntry('pom.xml', 'no')])]),
      fileEntry('notes.txt', 'x'),
    ]);
    const res = await collectFromDataTransfer(dataTransfer([tree]), accept);
    expect(res.files.map((f) => f.path)).toEqual(['repo/front/package.json', 'repo/back/pom.xml']);
  });

  it('falls back to the plain file list without entry support', async () => {
    const dt = { items: [], files: [file('pom.xml', '<project/>')] } as unknown as DataTransfer;
    const res = await collectFromDataTransfer(dt, accept);
    expect(res.files).toEqual([{ path: 'pom.xml', content: '<project/>' }]);
  });
});
