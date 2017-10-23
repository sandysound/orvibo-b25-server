const crc32 = require('buffer-crc32');
const crypto = require('crypto');

let pkt = function(packetBuffer) {
    this.magic = packetBuffer.slice(0,2);
    this.packetLength = packetBuffer.slice(2,4);
    this.packetType = packetBuffer.slice(4,6);
    this.crc32 = packetBuffer.slice(6,10);
    this.packetId = packetBuffer.slice(10,42);
    this.payload = packetBuffer.slice(42, packetBuffer.length);
};

pkt.prototype.logPacket = function(type) {
    console.log(type, JSON.stringify(this.payloadJSON));
};

pkt.prototype.getCommand = function() {
    return this.payloadJSON.cmd;
};

pkt.prototype.getSerial = function() {
    return this.payloadJSON.serial;
};

pkt.prototype.getUid = function() {
    return this.payloadJSON.uid;
};

pkt.prototype.getValue1 = function() {
    return this.payloadJSON.value1;
};

pkt.prototype.getModelId = function() {
    return this.payloadJSON.modelId;
};

pkt.prototype.processPacket = function(key) {
    this.payloadJSON = this.decodeJSON(key);
    this.orviboKey = key;
};

pkt.prototype.getOrviboKey = function() {
    return this.orviboKey;
};

pkt.prototype.validCRC = function() {
    return crc32(this.payload).toString('hex') === this.crc32.toString('hex');
};

pkt.prototype.packetTypeText = function() {
    return this.packetType.toString('ascii');
};

pkt.prototype.decodeJSON = function(key) {
    let decipher = crypto.createDecipheriv('aes-128-ecb', key, '');
    decipher.setAutoPadding(true);
    let decrypted = decipher.update(this.payload.toString('hex'), 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    // Sometimes there are bad chars on the end of the JSON so check here
    decrypted = decrypted.substring(0, decrypted.indexOf('}') + 1);
    return JSON.parse(decrypted);
};

module.exports = pkt;