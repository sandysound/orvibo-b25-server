const Orvibo = require('./Orvibo');
const http = require('http');
const url = require('url');

const httpPort = 3000;

// Create a settings object to pass PK key and map sockets to names
const settings = {
    LOG_PACKET: false, //Show incoming packet data from the socket
    ORVIBO_KEY: '', // put your PK key here as plain text (See Readme)
    plugInfo : [
        // Add uid and a name so you can easily identify the connected sockets
        {
            uid :'53dd7fe74de7',
            name: "Lamp in Kitchen"
        },
    ],
};

let orvibo = new Orvibo(settings);

// When a socket first connects and initiates the handshake it will emit the connected event with the uid of the socket;
orvibo.on('plugConnected', ({uid, name}) => {
    console.log(`Connected ${uid} name = ${name}`);
});

// If the socket state is updated this event will fire
orvibo.on('plugStateUpdated', ({uid, state , name}) => {
    console.log(`Plug ${name} ${uid} updated state ${state}`);
});

// The plug sends a hearbeat to let the server know it's still alive
orvibo.on('gotHeartbeat', ({uid, name}) => {
    console.log(`Plug ${name} ${uid} sent heartbeat`);
});

// Called when the plug disconnects
orvibo.on('plugDisconnected', ({uid, name }) => {
    console.log(`Plug ${uid} - ${name} disconnected`);
});

// Called when the plug disconnects with an error ie it's been unplugged
orvibo.on('plugDisconnectedWithError', ({uid, name }) => {
    console.log(`Plug ${uid} - ${name} disconnected with error`);
});



// Start the Orvibo socket server
orvibo.startServer();

// Create a basic example HTTP server
// If there are no parameters it will return the uid, state, modelId and name of the socket
// You can then use the uid to toggle the state of the switch like
// http://localhost:3000?uid=5dcf7ff76e7a

const requestHandler = (request, response) => {
    response.writeHead(200, {'Content-Type': 'application/json'});
    let q = url.parse(request.url, true).query;
    if (q.uid != null) {
        orvibo.toggleSocket(q.uid);
    }

    // Get all currently connected sockets, their names and states
    let sockets = orvibo.getConnectedSocket();

    response.end(JSON.stringify(sockets));
};

const httpServer = http.createServer(requestHandler);

httpServer.listen(httpPort, (err) => {
    if (err) {
        return console.log('something bad happened', err)
    }
    console.log(`http server is listening on ${httpPort}`)
});