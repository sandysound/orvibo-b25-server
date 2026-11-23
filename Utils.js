const crypto = require('crypto');

const randomFrom = function(chars, length) {
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars[crypto.randomInt(chars.length)];
    }
    return result;
};

module.exports.generateRandomTextValue = function(length) {
    return randomFrom('0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ', length);
};

module.exports.generateRandomHexValue = function(length) {
    return randomFrom('0123456789abcdef', length);
};

// A number with `length` digits that never starts with 0, so it keeps its length.
module.exports.generateRandomNumber = function(length) {
    return parseInt(randomFrom('123456789', 1) + randomFrom('0123456789', length - 1));
};
