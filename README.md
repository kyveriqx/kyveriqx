# Kyveriqx

A multi-tenant SaaS marketplace of AI tools — built exactly per `Asset/Kyveriqx_Architecture.docx`.

One Next.js monorepo. One shared `/core`. One folder per tool under `/tools`. Wildcard `*.kyveriqx.com` routes each subdomain to its tool.

## Repository layout

```
/
├── app/                        Next.js App Router routes
│   ├── page.tsx                marketing (kyveriqx.com)
│   ├── store/                  store (store.kyveriqx.com)
│   ├── auth/                   login + register
│   └── tools/<slug>/page.tsx   thin re-exports from /tools/<slug>/page.tsx
├── core/
│   ├── styles/tokens.css       design tokens (visual ref only)
│   ├── lib/                    supabase, razorpay, trigger, subdomain
│   └── ui/                     shared button, card, nav, tool-placeholder
├── tools/
│   ├── gstledgerreco/          page + jobs/reconcile.ts
│   ├── bankledgerreco/
│   ├── orgledgerreco/
│   ├── custportal/
│   ├── callingtool/            page + jobs/place-call.ts
│   └── whatsappcampaign/       page + jobs/send-campaign.ts
├── public/founder.webp         founder image asset
├── supabase/migrations/        0001_init.sql — schema, RLS, trial trigger
├── middleware.ts               subdomain router
└── ...
```

## Step 1 — Local dev

```bash
npm install
cp .env.example .env.local      # fill values as services come online
npm run dev
```

- `http://localhost:3000` → marketing site
- `http://gstledgerreco.lvh.me:3000` → GST reco tool (lvh.me resolves any subdomain to 127.0.0.1)
- `http://store.lvh.me:3000` → store

## Adding a tool a day (Architecture §3, §9)

1. Create `/tools/<slug>/page.tsx` and `/tools/<slug>/jobs/<name>.ts`.
2. Add a thin re-export at `/app/tools/<slug>/page.tsx`.
3. Insert a row in `tools`: `slug`, `subdomain`, `name`, `price`.
4. `git push` — Vercel redeploys, `<slug>.kyveriqx.com` is live.

No DNS work needed — the wildcard `*.kyveriqx.com` handles it.

## Build order (from Architecture §8)

| Step | What | Status |
|------|------|--------|
| 1 | Laptop + monorepo scaffold | done — see this repo |
| 2 | GitHub repo | pending — push this repo |
| 3 | Vercel + Hostinger DNS + Office 365 | pending — see §6 |
| 4 | Supabase (schema in `supabase/migrations/0001_init.sql`) | pending — create project, run migration |
| 5 | Trigger.dev jobs (stubs in `/tools/<slug>/jobs/`) | pending — connect project |
| 6 | Razorpay billing | done — `/store/checkout` + `/api/billing/subscribe` + `/api/webhooks/razorpay` |

## Documents

The plan and the architecture brief live under `Asset/`:
- `Kyveriqx_Architecture.docx` — technical source of truth
- `kyveriqx compnay brif.docx` — brand positioning
- `kyveriqx_landing_page.md`, `kyveriqx website html code.docx` — visual reference only
