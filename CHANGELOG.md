# CHANGELOG

## 1.2.0

* Buffer incoming TCP data and split it into packets, so coalesced or split packets are no longer dropped as bad CRCs.
* Add `setState(uid, on)` to set a plug explicitly. `toggleSocket` now turns a plug on when its state isn't known yet (it used to turn it off).
* Emit `plugStateUpdated` when a plug confirms a command (cmd 15), not only when it reports a state change itself.
* Drop the stale connection when a plug reconnects, so commands reach the live one.
* Drop connections that have been silent for `idleTimeoutMs` (default 5 minutes), so unplugged sockets are noticed.
* Fix crashes and wrong-socket removal when a connection closes before its handshake or errors and closes.
* State is per server instance instead of module-wide; `port`, `bindHost` and `idleTimeoutMs` are settings.
* Throw instead of `process.exit` when the key is missing or not 16 characters.
* Use `crypto.randomInt` for session keys and `Buffer.from` instead of the deprecated `new Buffer`.
* Add tests (`npm test`) with a fake plug.

## 1.1.0

* Add try-catch around packet decryption to guard against a service crash resulting from an occasional packet decryption error.
* Pluralize getConnectedSocket + alias previous name
* Enhance settings handling
* Enhance Orvibo logging

## 1.0.0

Initial release
