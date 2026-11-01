import { defineVessel } from '@maelstrom-co/protocol';

export const LAB_MARKER_SLUGS = ['hemoglobin', 'platelets', 'glucose'] as const;
export type LabMarkerSlug = (typeof LAB_MARKER_SLUGS)[number];

export const labsVessel = defineVessel({
  id: 'labs',
  name: 'Labs',
  description:
    'Demo-only lab marker selection with list and trends views. Use `labs-main` for the primary Instance ID; use a distinct ID for any additional Labs Instance. Requests to open or add the Labs panel can display its empty default trends view. No lab results or trend data are available; explain this limitation when opening the panel. Opening the panel does not retrieve or analyze results. Selecting a marker changes only its label; never claim measurements, trends or medical advice.',
  defaultVariant: 'trends',
  variants: {
    list: {
      props: {},
      minSize: { width: 5, height: 3 },
      actions: [
        {
          name: 'showTrends',
          description: 'Open the trends view; no trend data is available',
          transitionsTo: 'trends',
          idempotent: true,
        },
      ],
    },
    trends: {
      props: {},
      minSize: { width: 5, height: 3 },
      actions: [
        {
          name: 'showList',
          description: 'Open the list view; no lab results are available',
          transitionsTo: 'list',
          idempotent: true,
        },
        {
          name: 'selectMarker',
          description: 'Select a marker label only; no trend data is available',
          parameters: [
            {
              name: 'markerSlug',
              type: 'string',
              required: true,
              enum: [...LAB_MARKER_SLUGS],
              description: 'Marker to select: hemoglobin, platelets or glucose',
            },
          ],
          idempotent: true,
        },
      ],
    },
  },
});
