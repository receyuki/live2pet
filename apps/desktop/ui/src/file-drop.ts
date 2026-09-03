export function hasDraggedFiles(dataTransfer: Pick<DataTransfer, 'types'>): boolean {
  return Array.from(dataTransfer.types).includes('Files');
}

export function isProjectFile(file: Pick<File, 'name'>): boolean {
  return /\.live2pet$/i.test(file.name);
}
