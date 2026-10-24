/** Reads dropped/picked files and folders into { path, content }, keeping only dependency files. */

// never worth walking into: dependencies, VCS, build outputs, virtualenvs
const SKIPPED_DIRS = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  'target',
  'dist',
  'build',
  'out',
  '.angular',
  '.next',
  '.venv',
  'venv',
  '__pycache__',
  '.gradle',
  '.idea',
]);
// a large monorepo: hundreds of modules, each with its manifest (and lockfile)
const MAX_FILES = 1000;
const MAX_FILE_BYTES = 5 * 1024 * 1024;

interface CollectedFile {
  path: string;
  content: string;
}
export interface CollectResult {
  files: CollectedFile[];
  skipped: string[]; // too large / over the limit
}

type Accept = (path: string) => boolean;

/** From an <input type=file> (multiple or webkitdirectory). */
export async function collectFromFileList(list: FileList | File[], accept: Accept): Promise<CollectResult> {
  const entries = [...list].map((f) => ({ path: f.webkitRelativePath || f.name, file: f }));
  return read(
    entries.filter((e) => !e.path.split('/').some((part) => SKIPPED_DIRS.has(part))),
    accept,
  );
}

/** From a drop event: files and whole folders (webkitGetAsEntry). */
export async function collectFromDataTransfer(dt: DataTransfer, accept: Accept): Promise<CollectResult> {
  const roots = [...dt.items]
    .filter((i) => i.kind === 'file')
    .map((i) => i.webkitGetAsEntry?.())
    .filter((e): e is FileSystemEntry => !!e);
  if (!roots.length) return collectFromFileList(dt.files, accept);
  const found: { path: string; file: File }[] = [];
  for (const root of roots) await walk(root, '', found, accept);
  return read(found, accept);
}

async function walk(entry: FileSystemEntry, prefix: string, out: { path: string; file: File }[], accept: Accept) {
  const path = prefix ? `${prefix}/${entry.name}` : entry.name;
  if (entry.isFile) {
    if (accept(path) && out.length <= MAX_FILES) {
      out.push({ path, file: await new Promise<File>((ok, ko) => (entry as FileSystemFileEntry).file(ok, ko)) });
    }
    return;
  }
  if (SKIPPED_DIRS.has(entry.name)) return;
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  // readEntries returns batches until an empty one
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((ok, ko) => reader.readEntries(ok, ko));
    if (!batch.length) break;
    for (const child of batch) await walk(child, path, out, accept);
  }
}

async function read(entries: { path: string; file: File }[], accept: Accept): Promise<CollectResult> {
  const files: CollectedFile[] = [];
  const skipped: string[] = [];
  for (const { path, file } of entries) {
    if (!accept(path)) continue;
    if (files.length >= MAX_FILES || file.size > MAX_FILE_BYTES) {
      skipped.push(path);
      continue;
    }
    files.push({ path, content: await file.text() });
  }
  return { files, skipped };
}
