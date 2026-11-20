# Landlog setup notes

**Live site:** https://emmettmack.github.io/landlog/  (GitHub Pages, deploys from `main`)
**Database:** Supabase project `landlog`. Keys for the browser are in `config.js` (publishable key, safe to expose).

## Backend
- `supabase.sql` then `supabase-v2.sql` build every table, rule and function. Both are safe to re-run.
- Anyone can read, and add reviews/landlords. Nobody can edit or delete through the public key.
- Server-side rules: 6 reviews/day per device or account, 20/day per network, one review per address per person per 30 days,
  no phone numbers/emails/links, blocked-word list, `verified` set only from a signed-in .edu email, reports and votes counted per person.
- Edit/delete your own review works through a secret token stored in your browser (or your account).
- Photos go to a public bucket and stay hidden until approved in Admin.

## Admin
Sign in at `#/account` with the admin email, then open `#/admin`. Admin status is the `admins` table (add an email with
`insert into admins (email) values ('you@example.com');` in the SQL editor).
Tabs: Reviews (reports, hide/restore/delete), Photos, Claims, Owners (CSV import, building names), Entities, Words, Analytics, Data (export).

## Automatic jobs (GitHub Actions)
- `refresh-data.yml`: monthly rebuild of `addresses.js` (LA County parcels + LAHD violations + eviction notices).
- `backup.yml`: weekly JSON snapshot of the public data into `backups/`.

## Known limits
- Supabase's built-in email sender is rate limited (a few emails an hour). Fine for a handful of sign-ins; add your own SMTP
  (Authentication > SMTP Settings, e.g. Resend's free tier) before many people sign in.
- Free Supabase projects pause after a week with no traffic and have no automatic database backups; the weekly snapshot above covers public data.
- Owner names are not in open data. Add them in Admin > Owners from an Assessor file, or they appear as tenants add landlords.
- Set `hideSamples: true` in `config.js` once enough real reviews exist to hide the invented example entries.
