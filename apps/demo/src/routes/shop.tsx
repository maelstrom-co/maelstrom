import { createFileRoute } from '@tanstack/react-router';
import { ShopPage } from '../components/shop-page';
import { isHosted } from '../lib/hosted-mode';

export const Route = createFileRoute('/shop')({
  ssr: !isHosted(),
  component: ShopPage,
});
