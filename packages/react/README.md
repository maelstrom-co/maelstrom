# @maelstrom-co/react

React bindings for Maelstrom.

This library provides React-specific components and hooks:
- `<MaelstromProvider>` - Context provider
- `<Chart>` - Canvas component for vessels
- `useMaelstrom()` - Hook for vessels to communicate
- `useVesselRegistration()` - Hook to register vessel metadata and component
- `vesselRegistration()` - Helper to create vessel registrations with type-safe lazy loading

## Basic Usage

```tsx
import {
  MaelstromProvider,
  Chart,
  useVesselRegistration,
  useCreateInstance,
} from '@maelstrom-co/react';
import { calendarRegistration } from './vessels/calendar.vessel';

function App() {
  return (
    <MaelstromProvider connector={connector} sessionId="my-session">
      <VesselSetup />
      <Chart />
    </MaelstromProvider>
  );
}

function VesselSetup() {
  useVesselRegistration(calendarRegistration);

  const createInstance = useCreateInstance();

  useEffect(() => {
    createInstance('calendar', {
      instanceId: 'calendar-1',
      position: { row: 0, column: 0 },
    });
  }, []);

  return null;
}
```

## Vessel Registration

Use the `vesselRegistration()` helper to create vessel registrations. This helper enforces that lazy-loaded vessels must provide a loading component.

### Eager Loading

For components bundled with the app, no loading component is needed:

```tsx
// calendar.vessel.ts
import { vesselRegistration } from '@maelstrom-co/react';
import CalendarComponent from './calendar.component';

export const calendarRegistration = vesselRegistration(
  calendarVessel,
  CalendarComponent,
);
```

### Lazy Loading (Recommended)

For lazy-loaded components, a loading component is required:

```tsx
// calendar.vessel.ts
import { vesselRegistration } from '@maelstrom-co/react';
import { CalendarSkeleton } from './calendar.skeleton';

export const calendarRegistration = vesselRegistration(
  calendarVessel,
  () => import('./calendar.component'),
  CalendarSkeleton, // Required for lazy loading
);
```

### Loading Component

Create a skeleton component that matches your vessel's layout:

```tsx
// calendar.skeleton.tsx
import type { VesselLoadingSkeletonProps } from '@maelstrom-co/react';

export function CalendarSkeleton({ vesselId, vesselName }: VesselLoadingSkeletonProps) {
  return (
    <div className="animate-pulse">
      <div className="h-4 bg-gray-300 rounded w-24" />
      <div className="h-32 bg-gray-200 rounded mt-2" />
    </div>
  );
}
```

### Vessel Component

Vessel components must use a default export for lazy loading compatibility:

```tsx
// calendar.component.tsx
import type { VesselComponentProps } from '@maelstrom-co/react';

export default function CalendarComponent({
  instance,
  variantProps,
  executeAction,
}: VesselComponentProps) {
  return <div>Calendar</div>;
}
```

## Running unit tests

Run `nx test @maelstrom-co/react` to execute the unit tests via [Vitest](https://vitest.dev/).
