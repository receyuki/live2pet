const path = require('node:path');

module.exports = {
  packagerConfig: {
    asar: true,
    name: 'Live2Pet',
    executableName: 'live2pet',
    extraResource: [path.resolve(__dirname, 'mapper-dist')],
  },
  makers: [],
};
