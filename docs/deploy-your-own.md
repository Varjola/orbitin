# Deploy your own Orbitin

Forks are welcome. This page takes a fork from a clean clone to its own
Cloudflare deployment. Nothing here needs access to the original project's
accounts, and a fork never reports anything to Orbitin.

## 1. Run it locally

Requirements: Node.js 24 (see `.nvmrc`) and Git.

```text
git clone https://github.com/<you>/orbitin.git
cd orbitin
npm ci
npm run dev
```

Open the address Vite prints (normally `http://localhost:5173/`). The
development server has no catalogue Worker, so it serves a **local development
catalogue** inside the page: every member of the official satellite groups and
every featured pick, under their real catalogue numbers but with synthetic
orbits and names starting with `SYNTHETIC`. Real Objects, search, groups and
examples all work offline. Add `?catalogue-fixture=off` to the address to turn
it off, or `?catalogue-fixture=fail` to see the failure path.

Before a change, run the same checks as CI:

```text
npm run typecheck
npm run typecheck:worker
npm run test:run
npm run build
npm run test:deployment
npm run test:versioning
```

## 2. Choose your names

The Wrangler configurations name four permanent Workers and their buckets:

| Config | Worker | Role |
| --- | --- | --- |
| `wrangler.orbitin.jsonc` | `orbitin` | Production frontend: the built app and `/catalog/v1/` |
| `wrangler.orbitin-dev.jsonc` | `orbitin-dev` | Development frontend, same code |
| `wrangler.catalogue.jsonc` | `orbitin-catalogue` | The scheduled catalogue producer |
| `wrangler.catalogue-monitor.jsonc` | `orbitin-catalogue-monitor` | Optional: watches the producer and e-mails you when it fails (section 5) |
| `wrangler.catalogue-fixture.jsonc` | `orbitin-catalogue-fixture` | Producer with the offline fixture provider, for testing |

The frontends and the producer bind the private R2 bucket `orbitin-catalogue`
(the fixture uses `orbitin-catalogue-preview`); the monitor binds only its own
bucket `orbitin-catalogue-monitor`. Worker names are global to your Cloudflare
account, so rename them if you like. The deployment checks in
`scripts/deployment/` assert these exact names and the branch each target
deploys from (`main` for production, `develop` for development); change the
checks together with the configurations.

Every Wrangler command selects a configuration explicitly with `-c`. The root
`wrangler.jsonc` is deliberately undeployable.

## 3. Deploy the frontend

```text
npx wrangler login
npx wrangler r2 bucket create orbitin-catalogue
ORBITIN_DEPLOY_CONFIRM=orbitin npm run deploy:orbitin
```

`deploy:orbitin` refuses to run on another branch than `main`, with
uncommitted changes, or without the confirmation variable. It builds the
application and deploys the frontend Worker with the files in `dist/`.
`public/_headers` sets the security headers for static files; unknown paths
get `public/404.html`.

Without a producer the bucket is empty, and Real Objects says the catalogue
cannot be loaded. Everything else works.

## 4. Optionally run your own catalogue producer

The producer retrieves current GP element sets from
[Space-Track.org](https://www.space-track.org/). To run it you need **your own
Space-Track account**, and you must follow the Space-Track user agreement and
API guidelines. USSPACECOM allows redistribution of basic SSA data accessed
through Space-Track.org on the condition of appropriate citation: keep the
citation `USSPACECOM / 18th Space Defense Squadron, accessed via
Space-Track.org` that every snapshot and the About panel carry, and the
"educational use only; not for conjunction assessment" statements.

```text
npx wrangler secret put SPACETRACK_IDENTITY -c wrangler.catalogue.jsonc
npx wrangler secret put SPACETRACK_PASSWORD -c wrangler.catalogue.jsonc
ORBITIN_DEPLOY_CONFIRM=orbitin-catalogue npm run deploy:catalogue
```

The producer runs hourly (`17 * * * *`), fetches one bounded page per run and,
the hour after a sweep's last page, one batched request for the curated group
members and featured picks in `src/data/curatedCatalogue.ts`. It then
publishes a complete snapshot, several hours after the first run. Changing
`CATALOGUE_CONFIG_REVISION` discards a sweep in progress and resets the
provider protection state; do it only on purpose.
[catalogue-and-omm.md](./catalogue-and-omm.md) describes the retrieval,
validation, failure handling and publication.

To try the whole pipeline without an account, deploy
`orbitin-catalogue-fixture`, which publishes a synthetic snapshot into the
preview bucket, or run it locally with `npm run dev:catalogue-fixture`.

The producer configuration declares an alert binding and names the monitor
as its Tail Worker (section 5). If you do not want alerts, remove the
`send_email` and `tail_consumers` entries from `wrangler.catalogue.jsonc`
(and the matching assertions in `scripts/deployment/workerConfig.check.mjs`)
before deploying; otherwise deploy the monitor first.

## 5. Optional e-mail alerts and the monitor

The producer and `orbitin-catalogue-monitor` can e-mail **you** when the
catalogue needs attention ([catalogue-and-omm.md](./catalogue-and-omm.md#operator-alerts)
lists what is reported). Mail uses a Cloudflare `send_email` binding that can
reach only addresses verified in your own Cloudflare account, so it never
reaches anyone else's mailbox. You need:

1. A domain of yours as a zone in your Cloudflare account, with
   [Email Routing](https://developers.cloudflare.com/email-routing/) enabled
   (it adds MX and TXT records to the zone).
2. Your mailbox added and verified as an Email Routing destination address.
3. The monitor's bucket and Worker, then its secrets:

   ```text
   npx wrangler r2 bucket create orbitin-catalogue-monitor
   npx wrangler r2 bucket create orbitin-catalogue-monitor-preview
   ORBITIN_DEPLOY_CONFIRM=orbitin-catalogue-monitor npm run deploy:catalogue-monitor
   npx wrangler secret put CATALOGUE_ALERT_TO -c wrangler.catalogue-monitor.jsonc
   npx wrangler secret put CATALOGUE_ALERT_FROM -c wrangler.catalogue-monitor.jsonc
   ```

4. The same two secrets on the producer:

   ```text
   npx wrangler secret put CATALOGUE_ALERT_TO -c wrangler.catalogue.jsonc
   npx wrangler secret put CATALOGUE_ALERT_FROM -c wrangler.catalogue.jsonc
   ```

`CATALOGUE_ALERT_TO` is your verified address, for example
`you@example.com`; `CATALOGUE_ALERT_FROM` is an address on your Email Routing
domain, for example `catalogue-alerts@example.com`. Keep both out of the
repository. Deploy the monitor before the producer, because the producer names
it as its Tail Worker. Without the secrets each Worker logs
`alerts: disabled` and otherwise runs normally; delete a secret to silence it.

## 6. Analytics and events in your fork

Two things report usage, and both stay in **your** account:

- **Cloudflare Web Analytics.** The beacon is added to the build only when
  `VITE_CF_WEB_ANALYTICS_TOKEN` holds a site token from your own Cloudflare
  dashboard, for example in an uncommitted `.env.production.local`. Without it
  there is no beacon.
- **Anonymous product and error events.** Production builds send a few
  coarse events to their own site's `POST /events/v1`, which writes them to the
  Workers Analytics Engine dataset bound as `USAGE_EVENTS` in your Worker
  configuration. Build with `VITE_ORBITIN_USAGE_EVENTS=off` to send nothing, or
  remove the `analytics_engine_datasets` binding to accept and discard them.

[privacy.md](./privacy.md) lists every event and what is stored. If you
publish your fork, update the privacy statement to match what you run.

## 7. Your own domain

Attach a custom domain to your frontend Worker in the Cloudflare dashboard,
and change the canonical URL and the link-preview addresses in `index.html`
(`canonical`, `og:url`, `og:image`, `twitter:image`) and the `canonical` link
in `public/changelog.html`. Redirect any other host names to it with a
Cloudflare Redirect Rule (status 301, keeping the path and query).

## Licences

The source code is MIT-licensed (`LICENSE`). Third-party data and imagery keep
their own terms, listed in `ATTRIBUTION.md`; in particular the star catalogue
file `public/assets/starfield/stars.bin` is CC BY-SA 4.0.
