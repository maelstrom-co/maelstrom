---
name: maelstrom-react-devtools-sdk
description: Version-matched guide for installing Maelstrom devtools through the React extension and preserving inspection across Provider lifetimes.
license: MIT
metadata:
  author: Maelstrom
  sdkPackage: '@maelstrom-co/react-devtools'
---

Read the installed package's `package.json` version as the version authority.
Confirm the extension fields and options against its exports and declarations.

Apply `devtools()` with the configured instance's `with()` method. The extension
attaches observation before its Providers connect. Mount `m.Devtools` once near
those Providers. Place it outside a conditional Provider when retained evidence
must remain accessible after unmount. Repeated mounts share the same panel.

Voice observation comes from the optional realtime library. Applications do not
need diagnostic callbacks. Keep provider credentials and Engine forwarding on
their owning server paths. The default adapter stays inactive outside development.
The `/production` entrypoint explicitly enables browser tools in every build.

For a concrete React integration and verification, read
[common tasks](references/common-tasks.md).
