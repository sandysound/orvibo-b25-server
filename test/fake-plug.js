// A minimal stand-in for a B25 plug: speaks the hello/handshake/heartbeat/state protocol over TCP.
const net = require('net');
const Packet = require('../OrviboPacket');
const PacketBuilder = require('../PacketBuilder');

const ID = 'a'.repeat(32);

class FakePlug {
    constructor({ port, uid, orviboKey, modelId = 'f8b11bed724647e98bd07a66dca6d5b6' }) {
        Object.assign(this, { port, uid, orviboKey, modelId });
        this.received = [];
        this.waiters = [];
        this.buffer = Buffer.alloc(0);
        this.sessionKey = null;
    }

    connect() {
        return new Promise((resolve, reject) => {
            this.socket = net.connect(this.port, '127.0.0.1', resolve);
            this.socket.on('error', reject);
            this.socket.on('data', chunk => {
                this.buffer = Buffer.concat([this.buffer, chunk]);
                const { frames, rest } = Packet.splitFrames(this.buffer);
                this.buffer = rest;
                for (const frame of frames) this.onFrame(frame);
            });
        });
    }

    onFrame(frame) {
        const p = new Packet(frame);
        p.processPacket(p.packetTypeText() === 'pk' ? this.orviboKey : this.sessionKey);
        const json = p.payloadJSON;
        if (json.cmd === 0) this.sessionKey = json.key;
        this.received.push(json);
        this.waiters = this.waiters.filter(w => (w.match(json) ? (w.resolve(json), false) : true));
    }

    next(match) {
        const found = this.received.find(match);
        if (found) {
            this.received.splice(this.received.indexOf(found), 1);
            return Promise.resolve(found);
        }
        return new Promise(resolve => this.waiters.push({ match, resolve: json => {
            this.received.splice(this.received.indexOf(json), 1);
            resolve(json);
        } }));
    }

    send(json) {
        const type = json.cmd === 0 ? 'pk' : 'dk';
        const key = type === 'pk' ? this.orviboKey : this.sessionKey;
        this.socket.write(PacketBuilder.buildPacket(type, ID, json, key));
    }

    async hello() {
        this.send({ cmd: 0, serial: 1, modelId: this.modelId });
        await this.next(j => j.cmd === 0);
        this.send({ cmd: 6, serial: 2, uid: this.uid });
        await this.next(j => j.cmd === 6);
    }

    close() {
        this.socket.end();
    }
}

module.exports = FakePlug;
