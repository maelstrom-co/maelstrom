# @maelstrom-co/devtools-protocol

Runtime-neutral schemas for local DevTools inspection. Browser and server modules
share these contracts without importing each other's implementations.

The protocol carries a versioned pairing handshake, opaque target IDs, correlated
read requests, bounded metadata results, and fixed error codes. It includes no
application Actions, recording commands, raw stores, or provider credentials.

Target IDs identify one authenticated browser connection. App handles identify
one collector lifetime within that connection. Reported app and request identities
remain projected strings because redaction can remove domain guarantees.
Unavailable or colliding app identities remain explicit and cannot authorize an evidence read.
Event pages identify their retained collection and report view omission separately
from source-wide collection loss. Missing connection-loss counts are `null`.

`localAppOrigin` accepts an exact HTTP loopback origin.
`localBridgeEndpoint` accepts only the fixed `/devtools` path on an explicit
`ws://127.0.0.1` port, without credentials, query parameters, or a fragment.
The envelope size limit is 256 KiB. Transport implementations must enforce it
before parsing or sending messages.
