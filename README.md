This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Organization catalog fallback

`src/data/services.json` and `src/data/services-expansion.json` are an offline
snapshot of the live `organizations` table. The app uses them when Supabase is
not configured (a volunteer's first local run, missing env, or API 503).

After any manual production correction (address, merge, delete), regenerate
both files from the live table and commit them with the log entry:

```bash
npm run db:export-catalog
```

Do not edit the JSON by hand, and do not run `scripts/generate-expansion-orgs.mjs`
— that script is the old synthetic seed and would restore stale listings.

Reasons for individual corrections live in
[`docs/manual-data-corrections.md`](docs/manual-data-corrections.md). A
populated stored address is no longer overwritten by the EOIR sync, and its
coordinates stay with that label (the row is not re-geocoded). Check that
file before a roster apply for merges, deletes, and name changes. `db:seed` is
for empty local databases only; never point it at production.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
