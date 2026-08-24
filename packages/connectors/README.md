# @maelstrom-co/connectors

Transport-level connection contracts shared by Maelstrom clients and engine
hosts: heartbeat wire shapes, WebSocket close-code classification, and
correlation guards.

A contract-layer leaf — it depends only on `@maelstrom-co/protocol`, so both
browser and server packages may import it. If you change anything a host or
client answers on the wire (the heartbeat frames in particular), update both
sides in the same commit; auto-response matching is byte-exact.
