# e3d Netdoctor Payment Gate

Phase 7 gates the paid end-to-end report flow before capture or PCAP analysis starts.

## Price Point

The v1 netdoctor report price is **500 e3d product-payment credits per report**. At the current e3d credit unit of 1 credit = 0.001 wE3D before discounts, this is 0.5 wE3D before any wallet or promotion discount.

The CLI enforces this expected spend amount locally after the e3d payment API responds. If the API reports a smaller spend, including a zero-credit route, netdoctor stops instead of generating an underpaid report.

## Output

`paid-report` defaults to printing JSON to stdout (payment receipt +
`findings`/`narrative`) — it does not automatically email the report. `--format
markdown|html`, `--output <file>`, and `--to <email>` work exactly like they do
on `report`; email delivery is opt-in via `--to`, not a side effect of paying.

## How balances are tracked

A credit key's balance is not a stored counter that gets decremented in
place. On the e3d payments backend (`productPaymentsService.js`), every
purchase is an append-only row in a `product_api_credit_purchases` table and
every spend an append-only row in `product_api_credit_spends` table, each
scoped by `product` (`netdoctor`) and `key_hash` — the raw credit key run
through SHA-256; the raw key itself is never stored server-side. Balance is
computed on read, not maintained as mutable state:

```
balance = sum(issued_credits WHERE product, key_hash)
        - sum(credits_spent  WHERE product, key_hash)
```

Practically, this means: buying more credits always adds to the same running
total rather than resetting it, a balance never silently expires on its own,
and every purchase/spend is independently auditable after the fact. The
`spendCredits` call that `paid-report` makes (see below) is keyed by a stable
request ID for the same reason — retrying with that ID reuses the existing
spend row instead of writing a duplicate one.

None of this ledger lives on the machine running the CLI. What (if anything)
gets cached locally — a saved wallet-batch credit key, or nothing at all for
the card/env-var paths — is covered in the README's ["How credits are
remembered and used"](../README.md#how-credits-are-remembered-and-used).

## Wallet payments (`--wallet`)

`paid-report --wallet <address>` pays without a pre-provisioned credit key, by
connecting a wallet in the browser instead (see the README's "Paying for a
report" section for the full user-facing flow). `--payment-method` selects
which chain/token to pay with — `ethereum` (E3D on Ethereum mainnet, the
default) or `base` (wE3D on Base). Both are backed by the same e3d
product-payment credit system and the same 500-credit price; they only differ
in which chain the transfer happens on and which token is required.

## Required Payment Configuration

The payment client is modeled on `e3d-agent/src/e3d/payments-client.ts` and uses the e3d product-payment credit system.

Required runtime values:

- `NETDOCTOR_PAYMENT_CREDIT_KEY` or `E3D_PAYMENT_CREDIT_KEY`: the requester credit key to spend (from a Stripe purchase, wallet payment, or a pre-provisioned key).
- `NETDOCTOR_PAYMENT_SERVICE_KEY`: **optional.** The internal service key `/api/payments/credits/spend` requires to authorize a spend, on top of the credit key itself. The CLI ships with a working default (`DEFAULT_NETDOCTOR_INTERNAL_SERVICE_KEY` in `src/paymentGate.js`) scoped to the netdoctor product only, so a normal customer never needs to set this — it only lets a caller spend the specific credit key it already presents, nothing more. Only set this if you're running the payment client against your own, separately registered e3d payments backend.
- `E3D_BASE_URL`: optional, defaults to `https://e3d.ai`.
- `NETDOCTOR_PAYMENT_PRODUCT`: optional, defaults to `netdoctor`.
- `NETDOCTOR_REPORT_ROUTE`: optional, defaults to `/netdoctor/report`.
- `NETDOCTOR_REPORT_PRICE_CREDITS`: optional, defaults to `500`.

The core e3d payment service must have the configured product and route enabled at the same 500-credit report cost. Until that server-side product is registered, the paid flow fails closed and no report is generated.

## Failure Behavior

Payment failure:

- No live capture runs.
- No supplied PCAP is parsed.
- No report is generated or delivered.
- The CLI prints an actionable payment message with the e3d credit purchase path.

Failure after payment succeeds:

- v1 does not issue an automatic refund or credit.
- The spend call is keyed by a stable request ID, so retrying with the same request ID reuses the idempotent payment record and avoids a duplicate charge.
- Operators should ask the requester to retry the same report request with the same `--request-id` after fixing the downstream issue, such as capture permissions, SMTP delivery, or local tshark errors.

This policy keeps the implementation fail-closed while avoiding undefined post-payment behavior.
