const net = require('net');
const EventEmitter = require('events').EventEmitter;
const Packet = require('./OrviboPacket');
const PacketBuilder = require('./PacketBuilder');
const Utils = require('./Utils');
const Settings = require('./OrviboSettings');

const HELLO = 0;
const HANDSHAKE = 6;
const STATE_UPDATE_CONFIRM = 15;
const HEARTBEAT = 32;
const STATE_UPDATE = 42;

// Orvibo uses 0 for on and 1 for off.
const STATE_ON = 0;
const STATE_OFF = 1;

const DEFAULTS = {
    ORVIBO_KEY: Settings.ORVIBO_KEY,
    LOG_PACKET: Settings.LOG_PACKET,
    plugInfo: Settings.plugInfo,
    port: 10001,
    bindHost: '0.0.0.0',
    // A plug that loses power never closes its TCP connection, so drop any connection that
    // has been silent this long. Plugs heartbeat well inside this window.
    idleTimeoutMs: 5 * 60 * 1000,
};

class Orvibo extends EventEmitter {
    constructor(userSettings = {}) {
        super();
        const s = Object.assign({}, DEFAULTS, userSettings);
        if ('PLUG_INFO' in userSettings) s.plugInfo = userSettings.PLUG_INFO;

        if (!s.ORVIBO_KEY) {
            throw new Error('Orvibo PK key missing: pass ORVIBO_KEY in the settings or add it to OrviboSettings.js. See Readme');
        }
        if (Buffer.byteLength(s.ORVIBO_KEY) !== 16) {
            throw new Error('ORVIBO_KEY must be 16 characters');
        }

        this.settings = s;
        this.logger = console;
        // One entry per TCP connection: { id, socket, data, buffer } where data is the session state.
        this.connections = new Map();
    }

    setLogger(newLogger) {
        this.logger = newLogger;
    }

    getNameForUid(uid) {
        const item = (this.settings.plugInfo || []).find(i => i.uid === uid);
        return item != null ? item.name : 'unknown';
    }

    startServer(callback) {
        this.logger.log(`Starting Orvibo socket server on port ${this.settings.port}`);
        this.server = net.createServer(socket => this.handleConnection(socket));
        this.server.listen(this.settings.port, this.settings.bindHost, callback);
        return this.server;
    }

    stopServer(callback) {
        for (const { socket } of this.connections.values()) socket.destroy();
        if (this.server) this.server.close(callback);
        else if (callback) callback();
    }

    handleConnection(socket) {
        const id = Utils.generateRandomTextValue(16);
        const conn = { id, socket, data: null, buffer: Buffer.alloc(0), hadError: false, replaced: false };
        this.connections.set(id, conn);

        socket.setKeepAlive(true, 10000);
        socket.setTimeout(this.settings.idleTimeoutMs);

        socket.on('data', chunk => {
            conn.buffer = Buffer.concat([conn.buffer, chunk]);
            const { frames, rest } = Packet.splitFrames(conn.buffer);
            conn.buffer = rest;
            for (const frame of frames) this.handleFrame(conn, frame);
        });

        socket.on('timeout', () => {
            this.logger.log(`Plug ${this.describe(conn)} idle for ${this.settings.idleTimeoutMs}ms, dropping connection`);
            conn.hadError = true;
            socket.destroy();
        });

        socket.on('error', err => {
            conn.hadError = true;
            this.logger.log(`Plug ${this.describe(conn)} socket error: ${err.message}`);
        });

        // 'close' fires exactly once, after 'end', 'error' or destroy(), so all cleanup lives here.
        socket.on('close', () => this.handleClose(conn));
    }

    handleClose(conn) {
        if (!this.connections.delete(conn.id)) return;
        // Connections that never finished the handshake, or were replaced by a newer one, mean nothing to callers.
        if (!conn.data || !conn.data.uid || conn.replaced) return;
        const { uid, name } = conn.data;
        if (conn.hadError) {
            this.logger.log(`Plug ${uid} - ${name} disconnected with error`);
            this.emit('plugDisconnectedWithError', { uid, name });
        } else {
            this.logger.log(`Plug ${uid} - ${name} disconnected`);
            this.emit('plugDisconnected', { uid, name });
        }
    }

    describe(conn) {
        return conn.data && conn.data.uid ? `${conn.data.uid} - ${conn.data.name}` : conn.id;
    }

    handleFrame(conn, frame) {
        const plugPacket = new Packet(frame);

        if (!plugPacket.validCRC()) {
            this.logger.log('Got invalid CRC');
            return;
        }

        try {
            if (plugPacket.packetTypeText() === 'pk') {
                plugPacket.processPacket(this.settings.ORVIBO_KEY);
            } else if (conn.data && conn.data.encryptionKey) {
                plugPacket.processPacket(conn.data.encryptionKey);
            } else {
                this.logger.log('Got session packet before hello, ignoring');
                return;
            }
        } catch (err) {
            this.logger.log('Failed to parse packet: ' + err);
            return;
        }

        this.settings.LOG_PACKET && plugPacket.logPacket('Socket -> ');

        switch (plugPacket.getCommand()) {
            case HELLO: return this.helloHandler(plugPacket, conn);
            case HANDSHAKE: return this.handshakeHandler(plugPacket, conn);
            case HEARTBEAT: return this.heartbeatHandler(plugPacket, conn);
            case STATE_UPDATE: return this.stateUpdateHandler(plugPacket, conn);
            case STATE_UPDATE_CONFIRM: return this.stateConfirmHandler(plugPacket, conn);
            default: return this.unknownCmdHandler(plugPacket, conn);
        }
    }

    respond(conn, data, packetFunction) {
        conn.data = data;
        conn.socket.write(packetFunction(data));
    }

    helloHandler(plugPacket, conn) {
        const data = {
            serial: plugPacket.getSerial(),
            encryptionKey: Utils.generateRandomTextValue(16),
            id: Utils.generateRandomHexValue(32),
            modelId: plugPacket.getModelId(),
            orviboKey: plugPacket.getOrviboKey(),
        };
        this.respond(conn, data, PacketBuilder.helloPacket);
    }

    handshakeHandler(plugPacket, conn) {
        const uid = plugPacket.getUid();
        const data = Object.assign({}, conn.data, {
            serial: plugPacket.getSerial(),
            uid,
            name: this.getNameForUid(uid),
        });
        this.respond(conn, data, PacketBuilder.handshakePacket);

        // A plug that rebooted or roamed reconnects before its old TCP session times out.
        // Drop the stale one so commands go to the live connection.
        for (const other of this.connections.values()) {
            if (other !== conn && other.data && other.data.uid === uid) {
                other.replaced = true;
                other.socket.destroy();
            }
        }

        this.logger.log(`Connected ${data.uid} name = ${data.name}`);
        this.emit('plugConnected', { uid: data.uid, name: data.name, modelId: data.modelId });
    }

    heartbeatHandler(plugPacket, conn) {
        const data = Object.assign({}, conn.data, {
            serial: plugPacket.getSerial(),
            uid: plugPacket.getUid(),
        });
        this.respond(conn, data, PacketBuilder.heartbeatPacket);
        this.logger.log(`Plug ${data.name} ${data.uid} sent heartbeat`);
        this.emit('gotHeartbeat', { uid: data.uid, name: data.name });
    }

    stateUpdateHandler(plugPacket, conn) {
        const data = Object.assign({}, conn.data, {
            serial: plugPacket.getSerial(),
            uid: plugPacket.getUid(),
            state: plugPacket.getValue1(),
        });
        this.respond(conn, data, PacketBuilder.comfirmStatePacket);
        this.logger.log(`Plug ${data.name} ${data.uid} updated state ${data.state}`);
        this.emit('plugStateUpdated', { uid: data.uid, state: data.state, name: data.name });
    }

    // The plug answers our cmd 15 with a cmd 15 of its own. Status 0 means it switched.
    stateConfirmHandler(plugPacket, conn) {
        const data = conn.data;
        if (!data || data.pendingState == null) return;
        const status = plugPacket.payloadJSON.status;
        const state = data.pendingState;
        data.pendingState = null;
        if (status != null && status !== 0) {
            this.logger.log(`Plug ${data.name} ${data.uid} rejected state change (status ${status})`);
            return;
        }
        data.state = state;
        this.emit('plugStateUpdated', { uid: data.uid, state, name: data.name });
    }

    unknownCmdHandler(plugPacket, conn) {
        const data = Object.assign({}, conn.data, {
            serial: plugPacket.getSerial(),
            uid: plugPacket.getUid(),
            cmd: plugPacket.getCommand(),
        });
        this.respond(conn, data, PacketBuilder.defaultPacket);
    }

    findConnection(uid) {
        for (const conn of this.connections.values()) {
            if (conn.data && conn.data.uid === uid && !conn.replaced) return conn;
        }
        return null;
    }

    // Turn a plug on (true) or off (false). Returns false if the plug isn't connected.
    setState(uid, on) {
        const conn = this.findConnection(uid);
        if (conn == null) {
            this.logger.log('Could not find socket ' + uid);
            return false;
        }
        const state = on ? STATE_ON : STATE_OFF;
        const data = conn.data;
        data.clientSessionId = data.clientSessionId || Utils.generateRandomHexValue(32);
        data.deviceId = data.deviceId || Utils.generateRandomHexValue(32);
        data.pendingState = state;
        conn.socket.write(PacketBuilder.updatePacket(Object.assign({}, data, {
            state,
            serial: Utils.generateRandomNumber(8),
        })));
        return true;
    }

    // Flip the plug. If its state isn't known yet, turn it on.
    toggleSocket(uid) {
        const conn = this.findConnection(uid);
        if (conn == null) {
            this.logger.log('Could not find socket ' + uid);
            return false;
        }
        return this.setState(uid, conn.data.state !== STATE_ON);
    }

    getConnectedSockets() {
        const sockets = [];
        for (const conn of this.connections.values()) {
            if (!conn.data || !conn.data.uid || conn.replaced) continue;
            sockets.push({
                name: conn.data.name,
                state: conn.data.state,
                uid: conn.data.uid,
                modelId: conn.data.modelId,
            });
        }
        return sockets;
    }

    getConnectedSocket() {
        return this.getConnectedSockets();
    }
}

Orvibo.STATE_ON = STATE_ON;
Orvibo.STATE_OFF = STATE_OFF;

module.exports = Orvibo;
