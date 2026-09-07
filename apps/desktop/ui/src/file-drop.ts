export function hasDraggedFiles(dataTransfer: Pick<DataTransfer, 'types'>): boolean {
  return Array.from(dataTransfer.types).includes('Files');
}

export function sourceFilesFromDrop(dataTransfer: Pick<DataTransfer, 'files' | 'items'>): File[] {
  for (const item of Array.from(dataTransfer.items)) {
    if (item.kind !== 'file' || !item.webkitGetAsEntry?.()?.isDirectory) continue;
    const directory = item.getAsFile();
    if (directory) return [directory];
  }
  return Array.from(dataTransfer.files);
}

export function isProjectFile(file: Pick<File, 'name'>): boolean {
  return /\.live2pet$/i.test(file.name);
}
