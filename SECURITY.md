# Security policy

## Supported versions

Only the latest release is supported: the latest `vX.Y.Z` of the server (Docker image
`ghcr.io/leomartindev/projo:latest`) and the latest `desktop-vX.Y.Z` of the desktop app. A fix
ships as a new release, which the server installs from **Administration → Updates** and the desktop
app installs by itself.

## Reporting a vulnerability

Do not open a public issue. Report it privately through GitHub:
[Report a vulnerability](https://github.com/LeoMartinDev/projo/security/advisories/new).

Include what you can of:

- the version of the server (and of the desktop app, if it is involved);
- what an attacker can do, and from where (internet, local network, a signed-in account, a profile);
- the steps or a request that reproduces it.

You will get an answer within a week. Once a fix is released, the advisory is published with credit
to you, unless you prefer otherwise.

## Scope

In scope: the server (API, authentication, invitations, profiles and their PINs, library access,
streaming URLs, updates), the web app, and the desktop app.

Out of scope: an instance exposed without HTTPS or behind a misconfigured reverse proxy, attacks that
need administrator access, and vulnerabilities of the third-party services projo calls (TMDB, segment
providers, GitHub).
