/** The collection operations exposed by the SDK's exported identifier schema. */
export type BoundedSdkSchema = {
  transform: (visit: (value: string) => string) => {
    array: () => {
      max: (length: number) => {
        safeParse: (input: string[]) => { success: boolean };
      };
    };
  };
};

/** Verifies valid identifier parsing and early rejection of oversized collections. */
export function assertBoundedSdkValidation(schema: BoundedSdkSchema): void {
  let visits = 0;
  const bounded = schema
    .transform((value) => {
      visits += 1;
      return value;
    })
    .array()
    .max(1);
  const healthy = bounded.safeParse(['first']);
  if (!healthy.success || visits !== 1)
    throw new Error('SDK validation healthy control failed');
  visits = 0;
  const result = bounded.safeParse(['first', 'second']);
  if (result.success || visits !== 0) {
    throw new Error(
      'SDK validation must reject oversized collections before parsing their elements.',
    );
  }
}

/** Checks the Zod version markers emitted by the SDK's pinned library compiler. */
export function assertBundledValidationSources(
  sources: readonly string[],
  name: string,
): void {
  for (const source of sources) {
    if (!source.includes('_zod')) continue;
    const versions = [
      ...source.matchAll(
        /\bmajor:\s*(\d+),\s*minor:\s*(\d+),\s*patch:\s*(\d+)/g,
      ),
    ];
    if (versions.length === 0)
      throw new Error(
        `${name}: embedded validator version could not be verified`,
      );
    for (const match of versions) {
      const [major, minor, patch] = match.slice(1).map(Number);
      if (
        major < 4 ||
        (major === 4 && (minor < 6 || (minor === 6 && patch < 6)))
      ) {
        throw new Error(
          `${name}: bundles vulnerable Zod ${major}.${minor}.${patch}`,
        );
      }
    }
  }
}

function probeVessel(values: number[]) {
  return {
    id: 'sdk-validation',
    name: 'SDK validation',
    description: 'Bounded validation probe',
    defaultVariant: 'default',
    variants: {
      default: {
        props: {},
        minSize: { width: 1, height: 1 },
        actions: [
          {
            name: 'probe',
            description: 'Bounded validation probe',
            parameters: [
              {
                name: 'choice',
                type: 'number',
                description: 'Probe choice',
                enum: values,
              },
            ],
          },
        ],
      },
    },
  } as const;
}

/** The public client registry surface needed by the artifact check. */
export type SdkVesselManagerConstructor = new () => {
  readonly size: number;
  registerVessel: (vessel: ReturnType<typeof probeVessel>) => {
    valid: boolean;
  };
  dispose: () => void;
};

/** Probes the client's own validator independently of the protocol package. */
export function assertBoundedClientValidation(
  Manager: SdkVesselManagerConstructor,
): void {
  const measure = (length: number) => {
    let visits = 0;
    const values: number[] = [];
    for (let index = 0; index < length; index += 1) {
      Object.defineProperty(values, index, {
        enumerable: true,
        configurable: true,
        get: () => {
          visits += 1;
          return index;
        },
      });
    }
    const manager = new Manager();
    try {
      const result = manager.registerVessel(probeVessel(values));
      return { valid: result.valid, visits, registered: manager.size };
    } finally {
      manager.dispose();
    }
  };
  const healthy = measure(1);
  if (!healthy.valid || healthy.visits < 1 || healthy.registered !== 1)
    throw new Error('Client validation healthy control failed');
  const oversized = measure(65);
  if (oversized.valid || oversized.visits !== 0 || oversized.registered !== 0)
    throw new Error(
      'Client validation must reject oversized enums before parsing their entries.',
    );
}
