const extensionConfig = require('./config.js');

function log(message, force) {
    const config = extensionConfig();
    if (nova.inDevMode() || config.log || force) {
        console.log(message);
    }
}

module.exports = {
    log,
};
