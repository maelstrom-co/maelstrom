# Define and validate a Vessel

Use `defineVessel` to preserve literal IDs and Variant types. Validate at a trust
boundary; the definition helper alone does not prove runtime validity.

```ts
import { defineVessel, validateVessel } from '@maelstrom-co/protocol';

export const status = defineVessel({
  id: 'status', name: 'Status', description: 'Show application status',
  defaultVariant: 'summary',
  variants: {
    summary: { props: {}, minSize: { width: 1, height: 1 }, actions: [] },
  },
});

export function inspectDefinition(input: unknown) {
  const result = validateVessel(input);
  return result.valid ? result.vessel : result.issues;
}
```

The dimensions above illustrate the shape. Measure the real capability before
choosing its minimum size. Successful validation produces branded identities;
keep those rather than bypassing the boundary with casts.

## Verify

Test invalid default Variants, duplicate Action/parameter names, and transition
targets absent from the definition. Parse incoming Envelopes with the installed
protocol APIs before dispatching them. A syntactically valid Action is not proof
that the current application principal may execute it.

## Troubleshoot

Validation issues include paths and messages. Report bounded, redacted issues
instead of raw request contents. A type-safe definition can still require runtime
validation when its values came from untrusted data.
