const net = require('net');
const Packet = require('./OrviboPacket');
const PacketBuilder = require('./PacketBuilder');
const Utils = require('./Utils');
const Settings = require('./OrviboSettings');
const EventEmitter = require('events').EventEmitter;

let logger = console;

let ORVIBO_KEY = Settings.ORVIBO_KEY;
let LOG_PACKET = Settings.LOG_PACKET;
let PLUG_INFO = Settings.plugInfo;

const Orvibo = function(userSettings = {}) {
    // Allow user to pass in settings
    if('ORVIBO_KEY' in userSettings) ORVIBO_KEY = userSettings.ORVIBO_KEY;
    if('plugInfo' in userSettings) PLUG_INFO = userSettings.plugInfo;
    if('PLUG_INFO' in userSettings) PLUG_INFO = userSettings.PLUG_INFO;
    if('LOG_PACKET' in userSettings) LOG_PACKET = userSettings.LOG_PACKET;

    if (ORVIBO_KEY === '') {
        logger.log('Please pass Orvibo PK key details via the constructor or add to OrviboSettings.js file. See Readme');
        process.exit(1);
    }
};

Object.assign(Orvibo.prototype, EventEmitter.prototype);

let HEARTBEAT = 32;
let HELLO = 0;
let HANDSHAKE = 6;
let STATE_UPDATE = 42;
let STATE_UPDATE_CONFIRM = 15;
let UNKNOWN_CMD = 'UNKNOWN_CMD';

let port = 10001;
let bindHost = '0.0.0.0';

let plugConnections = [];
let packetData = {};

let getNameForUid = (uid) => {
    let item = PLUG_INFO.find(item => item.uid === uid);
    return item != null ? item.name : 'unknown';
};

let getData = (id) => {
    return packetData[id];
};

let setData = (id, data) => {
    packetData[id] = data;
};

let respondAndSetData = (data, socket, packetFunction) => {
    setData(socket.id, data);
    socket.write(packetFunction(data));
};

let helloHandler = (plugPacket, socket) => {
    let pkData = {
        serial: plugPacket.getSerial(),
        encryptionKey: Utils.generateRandomTextValue(16),
        id: Utils.generateRandomHexValue(32),
        modelId: plugPacket.getModelId(),
        orviboKey: plugPacket.getOrviboKey()
    };
    respondAndSetData(pkData, socket, PacketBuilder.helloPacket);
};

let handshakeHandler = function(plugPacket, socket, socketData) {
    let uid = plugPacket.getUid();
    let pkData = Object.assign({}, socketData, {
        serial: plugPacket.getSerial(),
        uid,
        name: getNameForUid(uid)
    });
    respondAndSetData(pkData, socket, PacketBuilder.handshakePacket);
    logger.log(`Connected ${pkData.uid} name = ${pkData.name}`);
    this.emit('plugConnected', {uid:pkData.uid, name: pkData.name});
};

let heartbeatHandler = function(plugPacket, socket, socketData) {
    let pkData = Object.assign({}, socketData, {
        serial: plugPacket.getSerial(),
        uid: plugPacket.getUid()
    });
    respondAndSetData(pkData, socket, PacketBuilder.heartbeatPacket);
    logger.log(`Plug ${pkData.name} ${pkData.uid} sent heartbeat`);
    this.emit('gotHeartbeat', {uid:pkData.uid, name: pkData.name});
};

let stateUpdateHandler = function(plugPacket, socket, socketData) {
    let pkData = Object.assign({}, socketData, {
        serial: plugPacket.getSerial(),
        uid: plugPacket.getUid(),
        state: plugPacket.getValue1()
    });
    respondAndSetData(pkData, socket, PacketBuilder.comfirmStatePacket);
    logger.log(`Plug ${pkData.name} ${pkData.uid} updated state ${pkData.state}`);
    this.emit('plugStateUpdated', {uid:pkData.uid, state: pkData.state, name: pkData.name});
};

let stateConfirmHandler = function() {
    // Do nothing at this stage
};

let unknownCmdHandler = function(plugPacket, socket, socketData) {
    let pkData = Object.assign({}, socketData, {
        serial: plugPacket.getSerial(),
        uid: plugPacket.getUid(),
    });
    respondAndSetData(pkData, socket, PacketBuilder.defaultPacket);
};

Orvibo.prototype.handlers = function() {
    return {
        [HELLO]: helloHandler.bind(this),
        [HANDSHAKE]: handshakeHandler.bind(this),
        [HEARTBEAT]: heartbeatHandler.bind(this),
        [STATE_UPDATE]: stateUpdateHandler.bind(this),
        [STATE_UPDATE_CONFIRM] : stateConfirmHandler,
        [UNKNOWN_CMD]: unknownCmdHandler.bind(this)
    };
};

Orvibo.prototype.startServer = function() {

    let self = this;
    let handlers = this.handlers();

    logger.log(`Starting server Orvibo socket server on port ${port}`);

    this.server = net.createServer(function(socket) {

        socket.id = Utils.generateRandomTextValue(16);
        socket.setKeepAlive(true, 10000);
        plugConnections.push(socket);

        socket.on('data', function (data) {

            let socketData = getData(socket.id);
            let plugPacket = new Packet(data);

            if (!plugPacket.validCRC()) {
                logger.log('Got invalid CRC');
                return;
            }

            try {
                if (plugPacket.packetTypeText() === 'pk') {
                    plugPacket.processPacket(ORVIBO_KEY);
                } else {
                    plugPacket.processPacket(socketData.encryptionKey);
                }
            } catch(err) {
                logger.log('Failed to parse packet: ' + err);
                return;
            }

            LOG_PACKET && plugPacket.logPacket('Socket -> ');

            let handler = handlers[plugPacket.getCommand()];
            if (handler != null) {
                handler(plugPacket, socket, socketData);
            } else {
                handlers[UNKNOWN_CMD](plugPacket, socket, socketData);
            }
        });

        socket.on('end', function () {
            let pkData = getData(socket.id);
            logger.log(`Plug ${pkData.uid} - ${pkData.name} disconnected`);
            self.emit('plugDisconnected', {uid: pkData.uid, name: pkData.name});
            delete packetData[socket.id];
            plugConnections.splice(plugConnections.indexOf(socket), 1);
        });

        socket.on('error', (err) => {
            logger.log(err);
            logger.log(`Plug ${socket.id} - ${socket.name} disconnected with error`);
            self.emit('plugDisconnectedWithError', getData(socket.id));
            delete packetData[socket.id];
            plugConnections.splice(plugConnections.indexOf(socket), 1);

        });

    });

    this.server.listen(port, bindHost);
};

Orvibo.prototype.toggleSocket = function(uid) {

    let socketId = null;
    for (const key of Object.keys(packetData)) {
        if (packetData[key].uid === uid) {
            socketId = key;
            break
        }
    }
    if (socketId === null) {
        logger.log('Could not find socket ' + uid);
        return;
    }
    let socket = plugConnections.find(s => s.id === socketId);
    if (socket != null) {
        let socketData = getData(socketId);
        let data = Object.assign({}, socketData,{
            state: socketData.state === 1 ? 0 : 1,
            serial: Utils.generateRandomNumber(8),
            clientSessionId:  socketData.clientSessionId ? socketData.clientSessionId : Utils.generateRandomHexValue(32),
            deviceId: socketData.deviceId ? socketData.deviceId : Utils.generateRandomHexValue(32),
        });

        setData(socket.id, data);

        let packet = PacketBuilder.updatePacket(data);
        socket.write(packet);

    } else {
        logger.log('Can not find socket ');
    }
};

Orvibo.prototype.getConnectedSockets = function() {
    let sockets = [];
    for (const key of Object.keys(packetData)) {
        let socketData = getData(key);
        sockets.push({
            name: socketData.name,
            state: socketData.state,
            uid: socketData.uid,
            modelId: socketData.modelId
        });
    }
    return sockets;
};

Orvibo.prototype.getConnectedSocket = Orvibo.prototype.getConnectedSockets;

Orvibo.prototype.setLogger = function(newLogger) {
  logger = newLogger;
};

module.exports = Orvibo;
