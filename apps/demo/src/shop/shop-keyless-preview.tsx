import { KeylessVoiceProviderSelect } from '../components/voice-provider-select';
import { ShopHeader } from './shop-header';
import { ShopIntentForm } from './shop-intent-form';
import { cartTotals, useCartStore } from './stores/cart.store';
import { formatCents } from './stores/fixtures';
import { useOrdersStore } from './stores/orders.store';
import { SHOP_VOICE_PROVIDERS } from './voice-providers';

const PREVIEW_ORDER_COUNT = 3;

export function ShopKeylessPreview({
  intent,
  onIntentChange,
  onRequireKey,
  onBlockedSubmit,
}: {
  readonly intent: string;
  readonly onIntentChange: (intent: string) => void;
  readonly onRequireKey: () => void;
  readonly onBlockedSubmit: () => void;
}) {
  const { orders } = useOrdersStore();
  const { lines } = useCartStore();
  const itemCount = lines.reduce((sum, line) => sum + line.quantity, 0);

  return (
    <div className="demo-shell keyless-shell relative z-[2]">
      <ShopHeader>
        <KeylessVoiceProviderSelect options={SHOP_VOICE_PROVIDERS} />
        <button
          type="button"
          onClick={onRequireKey}
          className="status-pill rounded-full px-3 py-1 font-mono text-xs uppercase tracking-[.1em] text-ink-2"
        >
          API key
        </button>
        <div
          className="status-pill flex items-center gap-2 rounded-full px-3 py-1 font-mono text-xs uppercase tracking-[.1em] text-ink-2"
          role="status"
          aria-label="Connection status: key required"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-amber" />
          Key required
        </div>
      </ShopHeader>

      <main className="keyless-main">
        <div className="keyless-intro">
          <p className="eyebrow">Pet shop preview</p>
          <h2>Reorder pet food by asking for it.</h2>
          <p>
            Add an OpenAI API key to let Maelstrom bring in the catalog,
            checkout and order details as you ask. Type or speak, for example
            &ldquo;reorder my dog food but with less fat&rdquo;. The key stays
            in this tab's memory and is never persisted.
          </p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onRequireKey}
          >
            Start interactive demo
          </button>
        </div>

        <section className="keyless-chart" aria-label="Example pet shop">
          <section className="preview-card">
            <div className="preview-card-heading">
              <span>
                <i className="bg-brand" />
                Recent orders
              </span>
              <span>{orders.length} past</span>
            </div>
            <ul className="grid gap-4 text-sm">
              {orders.slice(0, PREVIEW_ORDER_COUNT).map((order) => (
                <li key={order.id} className="grid gap-1">
                  <span className="flex justify-between gap-2 font-mono text-xs text-ink-3">
                    <span>{order.id}</span>
                    <span>{order.placedOn}</span>
                  </span>
                  <span className="break-words">
                    {order.items
                      .map((item) => `${item.quantity}× ${item.name}`)
                      .join(', ')}
                  </span>
                </li>
              ))}
            </ul>
          </section>
          <section className="preview-card">
            <div className="preview-card-heading">
              <span>
                <i className="bg-amber" />
                Cart
              </span>
              <span>
                {itemCount} item{itemCount === 1 ? '' : 's'}
              </span>
            </div>
            {lines.length === 0 ? (
              <p className="text-sm text-ink-3">Your cart is empty.</p>
            ) : (
              <ul className="grid gap-3 text-sm">
                {lines.map((line) => (
                  <li key={line.sku} className="flex justify-between gap-2">
                    <span>
                      {line.quantity}× {line.name}
                    </span>
                    <span className="font-mono text-ink-2">
                      {formatCents(line.quantity * line.unitPriceCents)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {lines.length > 0 && (
              <p className="mt-4 text-right font-mono text-sm text-ink-2">
                Total {formatCents(cartTotals(lines).totalCents)}
              </p>
            )}
          </section>
        </section>
      </main>

      <div className="keyless-input border-t p-3 bg-bg-1">
        <div className="max-w-4xl mx-auto">
          <ShopIntentForm
            intent={intent}
            onIntentChange={onIntentChange}
            onSubmit={onBlockedSubmit}
            submitLabel="Add key"
            allowEmptySubmit
          />
        </div>
      </div>
    </div>
  );
}
