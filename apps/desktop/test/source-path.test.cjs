const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const mapperPath = path.resolve(__dirname, '../../mapper/index.html');

function loadSelectedSourcePath() {
  const mapper = fs.readFileSync(mapperPath, 'utf8');
  const start = mapper.indexOf('function selectedSourcePath');
  const end = mapper.indexOf('\n    async function inspectThroughDesktop', start);
  assert.notEqual(start, -1, 'selectedSourcePath must remain present in the Mapper');
  assert.notEqual(end, -1, 'selectedSourcePath must remain independently testable');

  const context = {
    localFilePath(file) {
      return file.path || null;
    },
  };
  vm.runInNewContext(`${mapper.slice(start, end)}\nglobalThis.selectedSourcePath = selectedSourcePath;`, context);
  return context.selectedSourcePath;
}

test('selected source path stays inside the chosen directory', () => {
  const selectedSourcePath = loadSelectedSourcePath();
  const sourceRoot = selectedSourcePath([
    {
      name: 'mojiaduoer_3.model3.json',
      path: '/Users/RY/Downloads/mojiaduoer_3/mojiaduoer_3.model3.json',
      webkitRelativePath: 'mojiaduoer_3/mojiaduoer_3.model3.json',
    },
  ]);

  assert.equal(sourceRoot, '/Users/RY/Downloads/mojiaduoer_3');
});

test('selected source path handles a nested file within the chosen directory', () => {
  const selectedSourcePath = loadSelectedSourcePath();
  const sourceRoot = selectedSourcePath([
    {
      name: 'texture_00.png',
      path: '/Users/RY/Downloads/mojiaduoer_3/textures/texture_00.png',
      webkitRelativePath: 'mojiaduoer_3/textures/texture_00.png',
    },
  ]);

  assert.equal(sourceRoot, '/Users/RY/Downloads/mojiaduoer_3');
});
