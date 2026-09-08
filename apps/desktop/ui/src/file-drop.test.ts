import { describe, expect, it } from 'vitest';
import { hasDraggedFiles, isProjectFile, isSourceDirectoryDrop, sourceFilesFromDrop } from './file-drop';

describe('file drop helpers', () => {
  it('recognizes file drags without treating text as a file', () => {
    expect(hasDraggedFiles({ types: ['Files'] })).toBe(true);
    expect(hasDraggedFiles({ types: ['text/plain'] })).toBe(false);
  });

  it('recognizes current, portable, and legacy project files', () => {
    for (const name of ['pet.l2p', 'pet.l2pack', 'pet.live2pet']) expect(isProjectFile({ name })).toBe(true);
    expect(isProjectFile({ name: 'pet.zip' })).toBe(false);
  });

  it('prefers the top-level directory file over expanded nested files', () => {
    const directory = new File([''], 'live2d');
    const nested = new File(['{}'], 'model3.json');
    const item = { kind: 'file', webkitGetAsEntry: () => ({ isDirectory: true }), getAsFile: () => directory };
    expect(sourceFilesFromDrop({ files: [nested] as unknown as FileList, items: [item] as unknown as DataTransferItemList })).toEqual([directory]);
    expect(isSourceDirectoryDrop({ files: [nested] as unknown as FileList, items: [item] as unknown as DataTransferItemList })).toBe(true);
  });
});
