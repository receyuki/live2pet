const links = require('./runtime-help-links.json');

function createRuntimeHelpWindowHandler(openExternal) {
  return ({ url }) => {
    if (Object.values(links).includes(url)) {
      void openExternal(url).catch(() => console.warn('Could not open runtime help in the system browser.'));
    }
    return { action: 'deny' };
  };
}

module.exports = { createRuntimeHelpWindowHandler };
