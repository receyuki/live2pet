export function hasDraggedFiles(dataTransfer: Pick<DataTransfer, 'types'>): boolean {
  return Array.from(dataTransfer.types).includes('Files');
}

export function sourceFilesFromDrop(dataTransfer: Pick<DataTransfer, 'files' | 'items'>): File[] {
  for (const item of Array.from(dataTransfer.items ?? [])) {
    if (item.kind !== 'file' || !item.webkitGetAsEntry?.()?.isDirectory) continue;
    const directory = item.getAsFile();
    if (directory) return [directory];
  }
  return Array.from(dataTransfer.files);
}

export function isSourceDirectoryDrop(dataTransfer: Pick<DataTransfer, 'files' | 'items'>): boolean {
  if (Array.from(dataTransfer.items ?? []).some(item => item.kind === 'file' && item.webkitGetAsEntry?.()?.isDirectory)) return true;
  const files = Array.from(dataTransfer.files);
  if (files.length < 2) return false;
  const roots = files.map(file => (file.webkitRelativePath || '').split('/').filter(Boolean)[0]).filter(Boolean);
  return roots.length === files.length && new Set(roots).size === 1;
}

export function isProjectFile(file: Pick<File, 'name'>): boolean {
  return /\.live2pet$/i.test(file.name);
}
