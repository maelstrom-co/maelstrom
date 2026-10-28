import { createMaelstrom } from '@maelstrom-co/react';
import { cartEntry } from './vessels/cart.vessel';
import { catalogEntry } from './vessels/catalog.vessel';
import { checkoutEntry } from './vessels/checkout.vessel';
import { ordersEntry } from './vessels/orders.vessel';

// A separate instance rather than a filter on the home `m`: the Provider sends
// its factory's whole vessel list as the Engine catalog on every chart
// request, so this keeps day-planner vessels out of the shop prompt.
export const shopM = createMaelstrom({
  vessels: [ordersEntry, catalogEntry, cartEntry, checkoutEntry] as const,
});
