# Provider selection and deployment

Select provider and deployment only from the user's goal and available evidence. Maelstrom's current voice documentation describes specific supported paths, including OpenAI Realtime and LiveKit Cascade. Do not imply support for an unspecified provider or install voice packages before the decision justifies them.

Keep provider keys and minter logic on server-owned layers. A short-lived, narrowly scoped Grant may cross to the browser only when required by the selected provider's documented flow. The application's server endpoint must independently enforce caller authentication, authorization, origin policy, and rate limits; a package Minter does not authenticate the caller. Keep any worker in its owning layer and never make server/worker packages depend on browser packages.

Read the selected provider's matching setup guide and deployment requirements, plus the public [voice architecture](https://maelstrom.co/docs/architecture/realtime-voice/), before implementation. Keep provider-specific differences visible. State exact package versions, deployment assumptions, and which credential, microphone, network, and Engine checks were or were not performed. Never expose real credentials in test fixtures or reports.
