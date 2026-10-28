# Experimental AG-UI workspace contract

`@maelstrom-co/agui-protocol` is a private contract package. Its root exports the wire schemas, correlation comparison, and non-content checkpoint evidence used by both runtime layers.

It depends only on `@maelstrom-co/protocol`, AG-UI schemas, and Zod. Browser and server implementations depend on this package; it depends on neither implementation.

See the [wire contract](./CONTRACT.md) and [adapter integration](../agui/README.md).
