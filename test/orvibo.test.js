const test = require('node:test');
const assert = require('node:assert');
const { once } = require('events');
const Orvibo = require('../Orvibo');
const Packet = require('../OrviboPacket');
const PacketBuilder = require('../PacketBuilder');
const FakePlug = require('./fake-plug');

const KEY = 'khggd54865SNJHGF';
const UID = '5ccf7f261234';
const quiet = { log() {} };

const startServer = async () => {
    const orvibo = new Orvibo({ ORVIBO_KEY: KEY, port: 0, bindHost: '127.0.0.1' });
    orvibo.setLogger(quiet);
    orvibo.startServer();
    await once(orvibo.server, 'listening');
    return { orvibo, port: orvibo.server.address().port };
};

test('packets round-trip through encrypt, frame and parse', () => {
    const json = { cmd: 32, serial: 5, uid: UID };
    const frame = PacketBuilder.buildPacket('dk', 'b'.repeat(32), json, KEY);
    const p = new Packet(frame);
    assert.ok(p.validCRC());
    p.processPacket(KEY);
    assert.deepStrictEqual(p.payloadJSON, json);
});

test('splitFrames handles coalesced, split and garbage-prefixed data', () => {
    const a = PacketBuilder.buildPacket('dk', 'b'.repeat(32), { cmd: 32 }, KEY);
    const b = PacketBuilder.buildPacket('dk', 'b'.repeat(32), { cmd: 42, value1: 0 }, KEY);
    const both = Buffer.concat([Buffer.from('xx'), a, b]);

    const whole = Packet.splitFrames(both);
    assert.strictEqual(whole.frames.length, 2);
    assert.strictEqual(whole.rest.length, 0);

    const partial = Packet.splitFrames(both.slice(0, 2 + a.length + 10));
    assert.strictEqual(partial.frames.length, 1);
    assert.strictEqual(partial.rest.length, 10);
});

test('rejects a missing or wrong-length key', () => {
    assert.throws(() => new Orvibo({ ORVIBO_KEY: '' }));
    assert.throws(() => new Orvibo({ ORVIBO_KEY: 'short' }));
});

test('plug connects, reports state, takes commands and disconnects', async () => {
    const { orvibo, port } = await startServer();
    const plug = new FakePlug({ port, uid: UID, orviboKey: KEY });
    await plug.connect();

    const connected = once(orvibo, 'plugConnected');
    await plug.hello();
    assert.strictEqual((await connected)[0].uid, UID);
    assert.deepStrictEqual(orvibo.getConnectedSockets().map(s => s.uid), [UID]);

    // Physical button press
    const updated = once(orvibo, 'plugStateUpdated');
    plug.send({ cmd: 42, serial: 3, uid: UID, value1: Orvibo.STATE_OFF });
    assert.strictEqual((await updated)[0].state, Orvibo.STATE_OFF);

    // Command from the server, confirmed by the plug
    assert.ok(orvibo.setState(UID, true));
    const cmd = await plug.next(j => j.cmd === 15);
    assert.strictEqual(cmd.value1, Orvibo.STATE_ON);
    assert.strictEqual(cmd.order, 'on');
    const confirmed = once(orvibo, 'plugStateUpdated');
    plug.send({ cmd: 15, serial: cmd.serial, uid: UID, status: 0 });
    assert.strictEqual((await confirmed)[0].state, Orvibo.STATE_ON);

    // Toggle flips from the known state
    orvibo.toggleSocket(UID);
    assert.strictEqual((await plug.next(j => j.cmd === 15)).value1, Orvibo.STATE_OFF);

    const gone = once(orvibo, 'plugDisconnected');
    plug.close();
    assert.strictEqual((await gone)[0].uid, UID);
    assert.deepStrictEqual(orvibo.getConnectedSockets(), []);
    await new Promise(r => orvibo.stopServer(r));
});

test('toggle with unknown state turns the plug on', async () => {
    const { orvibo, port } = await startServer();
    const plug = new FakePlug({ port, uid: UID, orviboKey: KEY });
    await plug.connect();
    await plug.hello();
    orvibo.toggleSocket(UID);
    assert.strictEqual((await plug.next(j => j.cmd === 15)).value1, Orvibo.STATE_ON);
    plug.close();
    await new Promise(r => orvibo.stopServer(r));
});

test('a reconnecting plug replaces its stale connection silently', async () => {
    const { orvibo, port } = await startServer();
    const disconnects = [];
    orvibo.on('plugDisconnected', e => disconnects.push(e));
    orvibo.on('plugDisconnectedWithError', e => disconnects.push(e));

    const first = new FakePlug({ port, uid: UID, orviboKey: KEY });
    await first.connect();
    await first.hello();
    const second = new FakePlug({ port, uid: UID, orviboKey: KEY });
    await second.connect();
    await second.hello();
    await once(first.socket, 'close');

    assert.strictEqual(orvibo.getConnectedSockets().length, 1);
    assert.deepStrictEqual(disconnects, []);
    orvibo.setState(UID, false);
    assert.strictEqual((await second.next(j => j.cmd === 15)).value1, Orvibo.STATE_OFF);

    second.close();
    await new Promise(r => orvibo.stopServer(r));
});

test('a connection that drops before hello does not crash or emit', async () => {
    const { orvibo, port } = await startServer();
    let emitted = false;
    orvibo.on('plugDisconnected', () => (emitted = true));
    const plug = new FakePlug({ port, uid: UID, orviboKey: KEY });
    await plug.connect();
    plug.socket.destroy();
    await new Promise(r => setTimeout(r, 50));
    assert.strictEqual(emitted, false);
    assert.strictEqual(orvibo.connections.size, 0);
    await new Promise(r => orvibo.stopServer(r));
});

test('a silent plug is dropped after the idle timeout', async () => {
    const orvibo = new Orvibo({ ORVIBO_KEY: KEY, port: 0, bindHost: '127.0.0.1', idleTimeoutMs: 100 });
    orvibo.setLogger(quiet);
    orvibo.startServer();
    await once(orvibo.server, 'listening');
    const plug = new FakePlug({ port: orvibo.server.address().port, uid: UID, orviboKey: KEY });
    await plug.connect();
    await plug.hello();
    const [e] = await once(orvibo, 'plugDisconnectedWithError');
    assert.strictEqual(e.uid, UID);
    await new Promise(r => orvibo.stopServer(r));
});
