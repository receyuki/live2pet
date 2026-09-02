const path = require('node:path');

module.exports = {
  packagerConfig: {
    asar: { unpack: '**/node_modules/{sharp,@img}/**/*' },
    name: 'Live2Pet',
    executableName: 'live2pet',
    extraResource: [path.resolve(__dirname, 'mapper-dist')],
  },
  makers: [],
};
