const fs = require('fs');
const orvibo = require('./Orvibo');
const express = require('express');

const logger = {
  logs: [],
  log: function(msg) {
    msg = Date.now() + " " + msg
    console.log(msg)
    this.logs.unshift(msg);
    if(this.logs.length > 100) {
      this.logs.pop();
    }
  }
};

const configStr = fs.readFileSync('config.json', 'utf8').trim();
const config = JSON.parse(configStr);

logger.log("Using config: " + configStr);

const httpServer = express();
const orviboServer = new orvibo({
  ORVIBO_KEY: config.orvibo_server.key,
  PLUG_INFO: config.orvibo_server.sockets
});
orviboServer.setLogger(logger);

httpServer.get('/', (req, res) => {
  res.type('html').sendFile('frontend.html', {root: __dirname});
});

httpServer.get('/logs', (req, res) => {
  res.json(logger.logs);
});

httpServer.get('/sockets', (req, res) => {
  res.json(orviboServer.getConnectedSocket());
});

httpServer.get('/sockets/:uid/', (req, res) => {
  let uid = req.params.uid;
  let sockets = orviboServer.getConnectedSockets()
  let socket = sockets.find((s) => { return s.uid == uid });
  if(socket == undefined) return res.sendStatus(404);
  res.json(socket);
});

httpServer.get('/sockets/:uid/:state', (req, res, next) => {
  let uid = req.params.uid
  let desiredState = (() => {
    let state = req.params.state;
    if(state == 'toggle') return -1;
    else if(state == 'on') return 0;
    else if(state == 'off') return 1;
  })();

  let sockets = orviboServer.getConnectedSockets();
  let socket = sockets.find((s) => { return s.uid == uid });
  if(socket == undefined) return res.status(404);

  if(desiredState != socket.state) {
    orviboServer.toggleSocket(socket.uid);
    return res.sendStatus(202);
  }

  res.sendStatus(200);
});

orviboServer.startServer();
logger.log("Starting HTTP control server on " + config.http_server.port);
httpServer.listen(config.http_server.port);
