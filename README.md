# Orvibo B25 Smart Socket Server

A server to control the B25 range of wifi Smart Sockets

While building a home automation system I bought a couple of Orvibo smart sockets from ebay that were advertised as the S20 model.
When they arrived they were actually the B25 (AUS) version and I could not find any node libraries to control them.

After a bit of searching, reading research by other people and some time with Wireshark I manged to setup
a relay server that would decrypt the packets going back and forth between the sockets and the server and worked out the protocol.

## Getting Started

To run this server you will need to have Node.js installed. I run v6.11.0 but it may work with earlier versions.

You will need to add the Orvibo PK key to decrypt and encrypt the initial packets. You can find this using helpful bash script from Grayda [getKey.sh](https://gist.github.com/Grayda/eb48093bcfb96bfeec9c58ea301f2668)
Once you have this key you will need to add it the ``OrviboSettings.js`` file.


Because these new sockets don't use UDP packets to communicate like the older versions you will also need to redirect all traffic from the host name 
```
homemate.orvibo.com
```
on TCP port 10001 the computer running the server.

I used an Ubuntu machine running dnsmasq and set this server as my DNS server in my router but depending on your network you might have to do it differntly.

```
server=8.8.8.8
address=/homemate.orvibo.com/192.168.0.106
``` 

Just a node: If you try to add a socket after you've redirected the DNS you will be ale to setup WiFi and use it with this library but your phone will probably timeout when trying to add the device
to the official Orvibo server.

### Installing

Clone the repo and then run
```
npm install 

```
to install the dependencies (buffer-crc32)


### Usage  

The best way to see how to use this library is to see ``Example.js`` 

To start the example http server run

```
npm start 

```
This will start the Orvibo socket server create a basic example HTTP server used for interacting with sockets.
Calling this http server with no parameters will return the uid, state, modelId and name of the socket.

You can then use the uid to toggle the state of the switch like http://localhost:3000?uid=5dcf7ff76e7a

One thing to note is the Orvibo uses 1 as off and 0 as on for the socket state.

## Configuration

One you've got a socket connecting you can add it to the plugInfo array in the OrviboSettings.js file.
This will match to uid to a name so you can easily see which socket is which.

## Contributing

I'm more than happy for other people to contribute to this library just send a pull request.
I'm also quite new to node.js so any constructive criticism will be happily accepted. 

## Authors

* **Sandy Milne** -  [SandySound - Github](https://github.com/sandysound)

## License

This project is licensed under the Apache 2.0 License - see the [LICENSE.md](LICENSE.md) file for details

## Acknowledgments

Big thanks to [Grayda](https://github.com/Grayda/) and [insertjokehere](https://github.com/insertjokehere) for all their research and hard work into how these sockets work 
