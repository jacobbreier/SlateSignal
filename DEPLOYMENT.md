# SlateSignal Deployment Plan

## 1. Deploy the Node app

Use Render or Railway first.

Build command:

```bash
npm install
```

Start command:

```bash
npm start
```

## 2. Environment Variables

Optional now, required for pro features:

```text
THE_ODDS_API_KEY=
STRIPE_SECRET_KEY=
STRIPE_PRICE_ID=
PUBLIC_BASE_URL=
OPENAI_API_KEY=
AUTH_PROVIDER=
DATABASE_URL=
```

## 3. Accounts

Recommended providers:

- Supabase Auth
- Clerk
- Auth0

Current local behavior is a demo account stored in browser local storage.

## 4. Payments

Use Stripe Checkout. The backend endpoint `/api/checkout` is already scaffolded.

Required:

- `STRIPE_SECRET_KEY`
- `STRIPE_PRICE_ID`
- `PUBLIC_BASE_URL`

## 5. Scheduled Updates

Use Render Cron Jobs, Railway cron, GitHub Actions, or a hosted scheduler.

Daily model lean creation:

```bash
curl -X POST https://your-site.com/api/jobs/daily
```

Settle final results:

```bash
curl -X POST https://your-site.com/api/jobs/settle
```

## 6. Real AI Analyst

The endpoint `/api/analyst/chat` is scaffolded. Keep it constrained to supplied matchup data so the AI cannot invent missing stats.
