const path = require('node:path');

module.exports = {
  packagerConfig: {
    asar: { unpack: '**/node_modules/{sharp,@img}/**/*' },
    name: 'Live2Pet',
    executableName: 'Live2Pet',
    icon: path.resolve(__dirname, 'assets', 'icon.icns'),
    extraResource: [path.resolve(__dirname, 'mapper-dist'), path.resolve(__dirname, 'renderer-dist')],
  },
  makers: [],
};
