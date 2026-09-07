export function sourcePathFromSelection(files: File[], getFilePath: (file: File) => string | null, directDrop = false): string | null {
  const first = files[0];
  if (!first) return null;
  const absolutePath = getFilePath(first);
  if (!absolutePath) return null;
  if (directDrop && files.length === 1) return absolutePath;
  if (/\.pck$/i.test(first.name)) return absolutePath;

  const relativePath = first.webkitRelativePath;
  const parts = relativePath.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  if (directDrop && !files.every(file => (file.webkitRelativePath || '').split('/').filter(Boolean)[0] === parts[0])) return null;
  let root = absolutePath;
  for (let index = 1; index < parts.length; index += 1) {
    const separator = Math.max(root.lastIndexOf('/'), root.lastIndexOf('\\'));
    if (separator <= 0) return null;
    root = root.slice(0, separator);
  }
  return root;
}

export function isSingleSourceSelection(files: File[], directDrop = false): boolean {
  if (!directDrop || files.length <= 1) return files.length > 0;
  const roots = files.map(file => (file.webkitRelativePath || '').split('/').filter(Boolean)[0]).filter(Boolean);
  return roots.length === files.length && new Set(roots).size === 1;
}

export function projectIdFromSourceName(name: string): string {
  const normalized = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return normalized || 'live2pet-project';
}
