const path = require('node:path');

module.exports = {
  packagerConfig: {
    asar: { unpack: '**/node_modules/{sharp,@img}/**/*' },
    name: 'Live2Pet',
    executableName: 'live2pet',
    extraResource: [
      path.resolve(__dirname, 'mapper-dist'),
      { from: path.resolve(__dirname, '../../skills/live2pet'), to: 'live2pet-skill' },
    ],
  },
  makers: [],
};
