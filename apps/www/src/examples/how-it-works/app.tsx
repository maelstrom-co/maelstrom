import { err, ok, type Result } from '@maelstrom-co/protocol';

export function TextInput(props: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <input
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
    />
  );
}

export function SendButton(props: { onClick: () => void }) {
  return (
    <button type="button" onClick={props.onClick}>
      Send
    </button>
  );
}

export function OrdersPanel() {
  return <p>Orders</p>;
}

export async function loadOrder(
  orderId: string,
): Promise<Result<undefined, Error>> {
  const response = await fetch(`/orders/${orderId}`);
  return response.ok
    ? ok(undefined)
    : err(new Error(`Order ${orderId} failed to load`));
}
