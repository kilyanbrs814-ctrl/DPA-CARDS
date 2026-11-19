# Public contact form

The landing page posts to `public-contact` with the project's public `apikey`.
Deploy this function with `verify_jwt = false`: its handler validates the apikey,
the allowed web/iPhone origin and the form payload itself. Merchant support keeps
its separate signed-in authentication flow.

Apply `20261119100522_public_contact_rate_limit.sql` before deploying. Its RPC is
restricted to `service_role`; the private table has RLS and no client grants.
Counters allow five submissions per IP in ten minutes and three per email per
hour. Only HMAC fingerprints are stored, with an hourly cleanup after expiry.
Contact messages are sent by email and are never inserted into customer tables.

The function reuses the existing `RESEND_API_KEY` and `EMAIL_FROM` secrets. The
recipient is fixed to `contact@digitalprojectagency.fr` on the server. Reply-To is
the validated visitor address. The browser never receives a sending credential.

The frontend keeps one request UUID while the submitted form values stay the same,
including retries after a failed or timed-out send.
That UUID becomes the provider idempotency key, including retries. Form values
are cleared only after the mail provider accepts the message.

Checks:

```sh
node --test scripts/check-contact-form.test.mjs
deno check --node-modules-dir=auto supabase/functions/public-contact/index.ts
npm run build
npm run test:static
```
