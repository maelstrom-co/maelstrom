import { defineVessel } from '@maelstrom-co/protocol';

export const checkoutVessel = defineVessel({
  id: 'checkout',
  name: 'Checkout',
  description:
    "Checkout for the pet-food store. Review view summarizes the current cart with totals, the customer's saved shipping address and saved payment method; placeOrder submits it. Confirmation view shows the placed order number and totals. Placed orders also appear in the orders vessel and the cart is emptied. Only call placeOrder once the cart holds exactly what the user wants.",
  defaultVariant: 'review',
  variants: {
    review: {
      props: {},
      minSize: { width: 4, height: 4 },
      actions: [
        {
          name: 'placeOrder',
          description:
            'Place an order for everything currently in the cart, shipped to the saved address and charged to the saved payment method. Fails if the cart is empty.',
          transitionsTo: 'confirmation',
        },
      ],
    },
    confirmation: {
      props: {},
      minSize: { width: 4, height: 3 },
      actions: [
        {
          name: 'returnToCheckoutReview',
          idempotent: true,
          description:
            'Dismiss the order confirmation and go back to reviewing the current cart for checkout.',
          transitionsTo: 'review',
        },
      ],
    },
  },
});
