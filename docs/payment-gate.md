# e3d Netdoctor Payment Gate

Phase 7 gates the paid end-to-end report flow before capture or PCAP analysis starts.

## Price Point

The v1 netdoctor report price is **500 e3d product-payment credits per report**. At the current e3d credit unit of 1 credit = 0.001 wE3D before discounts, this is 0.5 wE3D before any wallet or promotion discount.

The CLI enforces this expected spend amount locally after the e3d payment API responds. If the API reports a smaller spend, including a zero-credit route, netdoctor stops instead of generating an underpaid report.

## Required Payment Configuration

The payment client is modeled on `e3d-agent/src/e3d/payments-client.ts` and uses the e3d product-payment credit system.

Required runtime values:

- `NETDOCTOR_PAYMENT_CREDIT_KEY` or `E3D_PAYMENT_CREDIT_KEY`: the requester credit key to spend.
- `NETDOCTOR_PAYMENT_SERVICE_KEY`: internal service key accepted by the e3d `/api/payments/credits/spend` endpoint.
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
