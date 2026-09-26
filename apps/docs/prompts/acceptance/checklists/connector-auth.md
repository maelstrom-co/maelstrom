# Connector/auth prompt checklist

Use with `maelstrom-connector-auth` and a disposable fixture containing an existing
app-owned session boundary plus a Connector or transport stub. Never include real
credentials.

- [ ] Cites the installed Connector API and inspected application auth/session boundary.
- [ ] Keeps the Connector transport-only; product state and authorization remain app-owned.
- [ ] Identifies credential custody and does not request, expose, or log literal credentials.
- [ ] Separates retryable, terminal, canceled/disposed, expired-auth, and authorization failures only where supported by observed APIs.
- [ ] Identifies missing endpoint/token/reconnect decisions instead of inventing behavior.
- [ ] Labels stubbed checks as local and reports live transport checks as unrun unless actually exercised.