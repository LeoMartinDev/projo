# Public launch: what is missing

What projo still needs before it is shared publicly and can win users, the mobile and iPad apps
aside. Written on 2026-11-17, at server 1.28.1 and desktop 0.9.1.

The product side is largely there: public repository, website, installation guide, Docker image,
updates from the admin with rollback, desktop apps for Windows and macOS. What is missing is
mostly trust, ease of installation and visibility, plus a few product gaps that stop people from
leaving Plex or Jellyfin. For reference: 1 star, 2 downloads of the 1.28.0 release.

## 1. Repository hygiene (a few hours, do first)

- [ ] **`LICENSE` file.** The README says MIT, but GitHub detects no license. Many people and
      directories skip a project without one, and no list (awesome-selfhosted) will take it.
- [ ] **`SECURITY.md`.** projo is a server exposed to the internet, with accounts and invitations:
      it needs a private channel to report a vulnerability (GitHub private vulnerability reporting).
- [ ] **Issue templates** (`.github/ISSUE_TEMPLATE/`). A bug report asking for the version, the
      platform, the compose file and an excerpt of the logs (the NDJSON export already exists).
- [ ] **GitHub Discussions** enabled, for questions that are not bugs.
- [ ] **`CONTRIBUTING.md`.** The only contributor guide is `CLAUDE.md` (77 KB), and `bun lint`
      needs a canary Bun: a short guide for an outside contributor (setup, tests, lint, scope).

## 2. Make people want to try it

- [ ] **A demo instance.** projo's whole pitch is a better experience than Plex and Jellyfin, and
      that is shown more than described. A read-only demo with free content (Blender open movies)
      would be the strongest argument.
- [ ] **A short video or GIF** in the README and on the website: resume, "Skip intro", next
      episode autoplay, in a few seconds.
- [ ] **A comparison page** with Plex and Jellyfin on getprojo.com: what projo does, what it does
      not, and why. It will be the first question.

## 3. Ease of installation

- [ ] **A TMDB key is needed before anything works.** It is the first friction after installing.
      Jellyfin and Kodi ship their own key: check whether TMDB's terms allow projo to ship a
      default one, replaceable by the admin.
- [ ] **Templates for the common home-server platforms** (Synology is already covered): Unraid
      (Community Applications), TrueNAS apps, CasaOS, Umbrel, Proxmox helper scripts.
- [ ] **NVIDIA hardware transcoding (NVENC).** Only Intel VAAPI today; NVIDIA cards are common in
      home servers and their owners will ask on day one.
- [ ] **Signed desktop apps.** Windows: no Authenticode signature, so SmartScreen warns at install.
      macOS: ad hoc signature, not notarized, so Gatekeeper warns; no Intel build. For a new
      project, these warnings drive many people away.

## 4. Product gaps that stop people from switching

- [ ] **Import watch history from Plex or Jellyfin.** Probably the biggest concrete blocker: nobody
      wants to mark 800 episodes as watched by hand. A one-off import (Jellyfin API, Plex export)
      removes the objection.
- [ ] **Watching on the TV.** Chromecast and TV apps are "Permanently out of scope" in
      `PRODUCT.md` (§2.3), while projo is "made for a household". On r/selfhosted it will be the
      first objection. The choice holds, but it must either be stated plainly on the website or
      reopened (an Android TV app could start from the existing Expo code). To decide before the
      launch, not after.
- [ ] **Already planned for v2 and often asked for:** absolute numbering for anime (a large part of
      the self-hosting audience), subtitle download (OpenSubtitles), faithful ASS rendering, NFS/SMB
      network mounts.
- [ ] **More languages.** Only French and English. Opening translations through Weblate or Crowdin
      widens the audience at little cost.

## 5. Getting known (once 1 and 2 are done)

- [ ] A post on r/selfhosted ("I built…", with screenshots and the demo), the selfh.st newsletter,
      a "Show HN" on Hacker News, a listing on AlternativeTo next to Plex and Jellyfin.
- [ ] A submission to awesome-selfhosted (needs a license and, as far as I remember, a first
      release at least a few months old).
- [ ] A place to talk (GitHub Discussions or Discord) and a public roadmap, even a short one, drawn
      from the v2 section of `PRODUCT.md`.

## Order

1. `LICENSE`, `SECURITY.md`, issue templates.
2. Demo and video.
3. Default TMDB key, Unraid and TrueNAS templates.
4. Watch history import from Jellyfin and Plex.

The TV question is a product decision to take before the launch.
