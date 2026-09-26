# Realtime lifecycle and turn-taking

Keep voice optional and provider behavior explicit. Inspect the selected adapter's actual exports, lifecycle, and provider guide. A speech-native provider owns speech recognition, model, speech synthesis, and turn detection behind one connection; a cascade provider supplies transport while speech services run server-side. Do not flatten these distinct flows into a fictional common API.

Turn Mode—automatic turn-boundary detection or user-delimited turns—is runtime behavior of a live connection, not a fixed provider property. Observe and handle the supported runtime mode. Manage session connect/disconnect, cancellation, expiry/refresh, and teardown according to the selected adapter's evidenced contract; avoid claiming automatic reconnection unless documented and tested.

Speech supplies natural-language intent. The Engine remains the planner using client-owned Chart state. Voice UI is not automatically a Vessel. Consult the canonical public [realtime voice architecture](https://maelstrom.co/understanding/voice-architecture/) and its provider taxonomy, credential-custody, and turn-taking decisions linked there. Verify version-specific behavior locally; a source review is not a microphone/provider test.
