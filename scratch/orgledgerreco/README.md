# Org Ledger Reconciliation — R&D scratchpad

Standalone Node + xlsx playground for the Org Ledger Reconciliation tool.
**Nothing in this folder is deployed.**

## Status

The **production** matcher lives in [`core/lib/ledger/`](../../core/lib/ledger/):

- `types.ts` — shared shapes
- `parse-company.ts` — Your Company's ledger parser (Tally/BC export)
- `parse-partner.ts` — Your Business Partner's multi-location ledger parser
- `match-ledgers.ts` — the matching engine (TDS-aware, multi-location)
- `build-report.ts` — styled 4-sheet Excel report builder

Those files are a direct port of the live Python/Streamlit tool the user
already runs in production. The Trigger.dev task at
[`tools/orgledgerreco/jobs/reconcile.ts`](../../tools/orgledgerreco/jobs/reconcile.ts)
calls them end-to-end.

## What this scratchpad is for

1. **Real-data verification** — drop the customer's two `.xlsx` files into
   `sample-data/` and run the production parser+matcher against them, then
   diff the result against what the Python tool produces for the same input.
   Numbers must match.
2. **Generic-matcher experiments** — `matcher.ts` / `parse.ts` / `run.ts`
   in this folder are an *independent* 4-bucket matcher (matched, mismatched,
   onlyInA, onlyInB) that we may use for a different future tool. They do
   **not** model TDS, multi-location, or the company/partner asymmetry.

`sample-data/` is gitignored so customer files never get committed.

## Verify the production matcher against real data

```
# parity check: parse + reconcile + dump JSON
npx tsx scratch/orgledgerreco/verify-port.ts
```

(Add a small `verify-port.ts` next to this README that imports from
`core/lib/ledger/` and writes a JSON dump for side-by-side comparison with
the Python tool's output.)

## Generic-matcher tuning loop (kept for future tools)

```
npx tsx scratch/orgledgerreco/run.ts
```

Edit `matcher.ts` to try different key columns / tolerances. This is *not*
the production code path — it's a generic prototype.
