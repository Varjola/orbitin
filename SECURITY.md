# Security

## Reporting a vulnerability

Report security problems privately through GitHub's
[private vulnerability reporting](https://github.com/Varjola/orbitin/security/advisories/new),
not in a public issue. Include what you found, how to reproduce it and the
likely impact. A reply may take a few days.

## Scope

In scope: the application at [orbitin.net](https://orbitin.net), the code in
this repository and its Cloudflare Workers (the frontend with its
`/catalog/v1/` and `/events/v1` routes, the catalogue producer and its
monitor).

Out of scope: Cloudflare's own platform, Space-Track.org and other data
providers, denial of service by volume, and automated scanner reports without
a demonstrated problem.

## Design constraints

- The browser holds no secrets. Provider credentials exist only as secrets of
  the catalogue producer Worker, which has no public URL.
- The frontend Worker can only read the catalogue bucket, serves an allowlist
  of exact paths and accepts only small, allowlisted anonymous events.
- Shared scene links and files are validated completely before anything is
  opened, with bounded sizes and counts.
