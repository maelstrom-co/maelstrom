# Browser and React ownership

Keep framework-neutral client code framework-independent; React rendering, hooks, and bindings belong in `@maelstrom-co/react`. Reuse the application's existing UI and route boundaries. A voice control or other browser affordance is not automatically a Vessel; model only a user-visible capability the Engine can meaningfully select.

Browser code must not contain provider API keys or other long-lived secrets. Application authentication, authorization, origin policy, and rate limits stay application-owned. Verify installed package exports and the matching guide before importing an API; documentation examples may describe a different SDK version.

For voice UI, keep presentation and microphone interaction in the browser layer and submit speech as natural-language intent through the application's chosen flow. Do not move planning or app-owned data into a browser helper. Public React entry: [React integration guide](https://maelstrom.co/guides/react/creating-vessels/).
