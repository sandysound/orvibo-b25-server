const crc32 = require('buffer-crc32');
const crypto = require('crypto');

// Frame layout: magic "hd" (2) | total length (2, big endian) | type "pk"/"dk" (2) | crc32 (4) | id (32) | payload
const MAGIC = Buffer.from('6864', 'hex');
const HEADER_LENGTH = 42;

let pkt = function(packetBuffer) {
    this.magic = packetBuffer.slice(0, 2);
    this.packetLength = packetBuffer.slice(2, 4);
    this.packetType = packetBuffer.slice(4, 6);
    this.crc32 = packetBuffer.slice(6, 10);
    this.packetId = packetBuffer.slice(10, 42);
    this.payload = packetBuffer.slice(42, packetBuffer.length);
};

// TCP is a stream: one 'data' event can hold several packets or part of one.
// Returns the complete frames in `buffer` and whatever is left over for next time.
pkt.splitFrames = function(buffer) {
    const frames = [];
    let offset = 0;
    while (buffer.length - offset >= 4) {
        if (buffer[offset] !== MAGIC[0] || buffer[offset + 1] !== MAGIC[1]) {
            // Out of sync: skip ahead to the next magic, or drop everything but a trailing 'h'.
            const next = buffer.indexOf(MAGIC, offset + 1);
            if (next === -1) {
                offset = buffer[buffer.length - 1] === MAGIC[0] ? buffer.length - 1 : buffer.length;
                break;
            }
            offset = next;
            continue;
        }
        const length = buffer.readUInt16BE(offset + 2);
        if (length < HEADER_LENGTH) {
            offset += 2;
            continue;
        }
        if (buffer.length - offset < length) break;
        frames.push(buffer.slice(offset, offset + length));
        offset += length;
    }
    return { frames, rest: buffer.slice(offset) };
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
    let decipher = crypto.createDecipheriv('aes-128-ecb', key, null);
    decipher.setAutoPadding(true);
    let decrypted = decipher.update(this.payload.toString('hex'), 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    // Sometimes there are bad chars on the end of the JSON so check here
    decrypted = decrypted.substring(0, decrypted.indexOf('}') + 1);
    return JSON.parse(decrypted);
};

module.exports = pkt;
