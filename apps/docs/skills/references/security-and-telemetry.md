# Telemetry data boundaries

Inspect the application's telemetry, retention, access, and redaction conventions first. Subscribe only to evidenced SDK events needed for the stated diagnostic question, and bind cleanup to an observed owner lifecycle. Keep telemetry separate from product state and Connector transport.

Exclude credentials, authorization headers, intent/prompt contents, Vessel props, and sensitive user data by default. Raw errors may embed request data; do not forward them without checking the application's safe error policy. Prefer stable identifiers already supplied by the SDK, bounded labels, and explicit redaction. Do not add high-cardinality data or a parallel state store without a demonstrated need and authorization.

Test event mapping, redaction, and listener cleanup with deterministic local tests. A fake sink demonstrates local mapping, not deployed delivery, retention, or alerting. Report those infrastructure checks as unrun unless actually performed.
