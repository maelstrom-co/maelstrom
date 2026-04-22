import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared schemas
// ---------------------------------------------------------------------------

export const ChartPositionSchema = z.object({
  row: z
    .number()
    .int()
    .min(0)
    .describe('Row position on the chart (0-indexed)'),
  column: z
    .number()
    .int()
    .min(0)
    .describe('Column position on the chart (0-indexed)'),
});

export const ChartSizeSchema = z.object({
  width: z.number().int().min(1).describe('Width in chart cells'),
  height: z.number().int().min(1).describe('Height in chart cells'),
});

export const ActionExecutionSchema = z.object({
  instanceId: z.string().describe('The ID of the vessel instance to act upon'),
  action: z
    .string()
    .describe('The action name (must be valid for the current variant)'),
  paramsJson: z
    .string()
    .optional()
    .describe(
      'Optional JSON-encoded parameters for the action. Must be a valid JSON object string like {"orderId":"123"} or omitted if no params needed.',
    ),
});

// ---------------------------------------------------------------------------
// Grid layout
// ---------------------------------------------------------------------------

export const GridPositionSchema = z.object({
  instanceId: z.string().describe('The ID of the vessel instance to position'),
  position: ChartPositionSchema.describe(
    'Where to place the vessel on the chart',
  ),
  size: ChartSizeSchema.describe(
    'Size to allocate (must be >= variant minSize)',
  ),
});

export const GridLayoutSchema = z.object({
  positions: z
    .array(GridPositionSchema)
    .describe('Position and size for each visible instance'),
});

// ---------------------------------------------------------------------------
// Tiling layout
// ---------------------------------------------------------------------------

export const TilingNodeSchema = z
  .string()
  .nullable()
  .describe(
    'A node in the tiling binary tree: "H" for horizontal split (top/bottom), "V" for vertical split (left/right), vessel instance ID string for leaf nodes, or null for empty space.',
  );

export const TilingTreeSchema = z
  .array(TilingNodeSchema)
  .describe(
    'Preorder traversal of the tiling binary tree. Each split divides the current region in half.',
  );

export const VesselInstanceSnapshotSchema = z.object({
  instanceId: z
    .string()
    .describe(
      'Unique instance ID. For new instances, use format "vesselId-identifier" (e.g., "calendar-main", "biomarkers-detail").',
    ),
  vesselId: z
    .string()
    .describe('The vessel type ID (must match a registered vessel)'),
  variant: z
    .string()
    .describe(
      'The variant name for this instance (must be valid for the vessel)',
    ),
});

export const TilingLayoutSchema = z.object({
  tree: TilingTreeSchema.describe(
    'Binary tree layout as preorder traversal. Instance IDs in this tree are VISIBLE; omitted instances are HIDDEN.',
  ),
  instances: z
    .array(VesselInstanceSnapshotSchema)
    .describe(
      'All instances that should exist after this response. Include both existing instances (to keep) and new instances (to create). Instances not in this list will be deleted. IMPORTANT: When creating a new instance that needs configuration, you must ALSO add an action in executionPlan to configure it.',
    ),
});
