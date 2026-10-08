import { SHOP_LAYOUT } from '../lib/default-layout';
import { shop } from '../lib/pet-shop-maelstrom';
import { DemoWorkspace, type DemoWorkspaceConfig } from './home-page';
import { ShopVesselOptionSync } from './shop-vessel-option-sync';

/** Reorder-journey prompts shown in the first-run hint and intent suggestions. */
export const SHOP_EXAMPLES = [
  'Show me my past orders',
  'Find a dog food like my usual one but with less fat',
  'Add it to my cart and take me to checkout',
] as const;

export const SHOP_WORKSPACE: DemoWorkspaceConfig = {
  maelstrom: shop,
  initialLayout: () => SHOP_LAYOUT,
  OptionSync: ShopVesselOptionSync,
  examples: SHOP_EXAMPLES,
  theme: 'shop',
};

/** The demo page with only the pet-food shop vessels, in the shop palette. */
export function ShopPage() {
  return <DemoWorkspace config={SHOP_WORKSPACE} />;
}
