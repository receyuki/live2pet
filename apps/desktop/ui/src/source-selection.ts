export function sourcePathFromSelection(files: File[], getFilePath: (file: File) => string | null): string | null {
  const first = files[0];
  if (!first) return null;
  const absolutePath = getFilePath(first);
  if (!absolutePath) return null;
  if (/\.pck$/i.test(first.name)) return absolutePath;

  const relativePath = first.webkitRelativePath;
  const parts = relativePath.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  let root = absolutePath;
  for (let index = 1; index < parts.length; index += 1) {
    const separator = Math.max(root.lastIndexOf('/'), root.lastIndexOf('\\'));
    if (separator <= 0) return null;
    root = root.slice(0, separator);
  }
  return root;
}

export function projectIdFromSourceName(name: string): string {
  const normalized = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return normalized || 'live2pet-project';
}
