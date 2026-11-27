# Stripe setup (BE-17)

How payments work, and how to test them on your PC. Test mode only: no real money moves.

## How it works

```
Parent taps "Pay"  →  POST /api/v1/orders  →  our server: approved story? price from config
                                               → order (pending) → Stripe Checkout page
Browser            →  Stripe's page (card / Apple Pay / Google Pay / 3-D Secure)
Stripe             →  POST /api/v1/payments/stripe/webhook  (signed)
                      → order paid (once) → audit "order.paid" → hardback: printStatus "waiting"
Browser            →  /checkout/success?order=…  (asks GET /orders/:id until "paid")
```

The success page is only for show. **The webhook decides.**

## 1. Keys in `backend/.env`

| Setting | Where from |
|---|---|
| `STRIPE_SECRET_KEY=sk_test_…` | Stripe dashboard → Developers → API keys → Secret key |
| `STRIPE_WEBHOOK_SECRET=whsec_…` | Printed by `stripe listen` (step 3) |

A live key (`sk_live_…`) is refused outside production.

## 2. Install the Stripe CLI (once)

On Windows, with [Scoop](https://scoop.sh):

```powershell
scoop bucket add stripe https://github.com/stripe/scoop-stripe-cli.git
scoop install stripe
stripe login
```

Or download `stripe_X.Y.Z_windows_x86_64.zip` from https://github.com/stripe/stripe-cli/releases,
unzip it, and run `stripe.exe login`.

## 3. Forward webhooks to your PC

Leave this running in its own terminal while you test:

```bash
stripe listen --events checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed,checkout.session.expired --forward-to localhost:3000/api/v1/payments/stripe/webhook
```

Newer Stripe CLI versions (1.55+) need `--events`: these are the four events our webhook uses.

It prints `Your webhook signing secret is whsec_…`. Put that in `.env` as
`STRIPE_WEBHOOK_SECRET`, then restart the API (`pnpm dev`). The secret stays the same each time
you run `stripe listen` on this PC.

## 4. Test cards

Any future expiry date, any CVC, any name.

| Card | What happens | Screen |
|---|---|---|
| `4242 4242 4242 4242` | Paid | Success |
| `4000 0000 0000 0002` | Declined: Stripe's page says so and lets the parent try another card; "← Back" | Pay, "Payment not completed" |
| `4000 0025 0000 3155` | 3-D Secure: the bank's test screen; "Complete" pays | Success |

Watch the `stripe listen` terminal: `checkout.session.completed` should answer `[200]`.

**Forgot `stripe listen`?** The payment still counts. When the parent lands on the success page,
the server asks Stripe itself whether the order's payment page was paid (`syncWithStripe` in
`src/services/orders.ts`) and marks it paid with the same checks as the webhook. The webhook is
still needed for orders whose parent never comes back to the success page, and for failed or
expired payments, so keep `stripe listen` running when you test payments.

## 4b. Promo codes (discounts)

Codes are made in the Stripe dashboard, not in our code: **Product catalogue → Coupons → + Create coupon**,
then add a customer-facing code (e.g. `TEST20`) under the coupon. Stripe's payment page shows
"Add promotion code" (switch it off with `PROMO_CODES_ENABLED=false`). Stripe checks the code; our
webhook accepts the lower total only when paid + discount = our price, saves `amountPaidFils`,
`discountFils` and `promoCode`, and treats a 100%-off code (`no_payment_required`) as paid.
Coupons made for AED orders should use a percentage, or a fixed amount in **AED**.

## 5. Before dev, staging and production (AWS-02, AWS-04)

- In the Stripe dashboard → Developers → Webhooks, add an endpoint
  `https://<api domain>/api/v1/payments/stripe/webhook` with these events:
  `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
  `checkout.session.async_payment_failed`, `checkout.session.expired`.
  Its signing secret goes in the AWS secret store as `STRIPE_WEBHOOK_SECRET`.
- Settings → Payment methods: cards, Apple Pay and Google Pay on.
- Apple Pay: Settings → Payment method domains → add the frontend's domain.
- Prices: `PRICE_DIGITAL_AED`, `PRICE_HARDBACK_AED`, `DELIVERY_HARDBACK_AED` (set by Dina; the
  defaults 49 / 149 / 0 are placeholders).
