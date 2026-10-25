# projo

A self-hosted media server for movies and TV shows, built for a household. It plays the video files already on your disk, identifies them with TMDB and shows them in a Netflix-grade interface: continue watching, profiles, skip intro, next episode autoplay, with no settings to figure out.

The full specification is in [PRODUCT.md](PRODUCT.md), the reference design in [design/](design/README.md).

## What projo does

- Movies and TV shows, identified automatically, with posters, overviews and cast.
- Messy libraries welcome: a folder where movies and episodes are mixed together works.
- No file shows up while it is still downloading: projo waits until the file is complete and readable.
- Plays any file in the browser: direct play when possible, remux or transcode otherwise, with a quality picker.
- Audio and subtitles picked sensibly and remembered per show.
- Skip intro, skip end credits, next episode autoplay, using community databases (TheIntroDB, IntroDB, SkipDB) and local audio analysis.
- Accounts invited by link, up to 5 profiles per account with a PIN, per-library access and a maximum content rating.
- Full administration: libraries, pending files and files to review, accounts, active sessions, settings, jobs, notifications.
- Updates from the admin page, without redeploying the container, with rollback.
- French and English interface, dark theme, installable as a PWA.

projo does not do: music, photos, live TV, Chromecast, AirPlay, native TV apps, cloud, multi-tenancy, file renaming.

## Requirements

- A Linux x86_64 or arm64 machine with Docker and Docker Compose (v2, `docker compose`).
- Your videos on a disk this machine can read.
- A TMDB API key, free: create an account on [themoviedb.org](https://www.themoviedb.org/), then Settings → API. Without a key projo works but does not identify files (titles taken from file names, no images).
- A recent browser (Chrome, Edge, Firefox, Safari, iOS Safari, Android Chrome).

Transcoding is done in software: a file the browser cannot play directly uses the CPU. The transcoding cache takes up to 10 GB in `/data` (configurable).

## Installation

1. Create a folder for projo and put this `docker-compose.yml` in it (also at the root of the repository: [docker-compose.yml](docker-compose.yml)):

   ```yaml
   services:
     projo:
       image: ghcr.io/leomartindev/projo:latest
       ports:
         - '8080:8080'
       volumes:
         - ./projo-data:/data
         - /path/to/your/movies:/media/movies:ro
         - /path/to/your/shows:/media/shows:ro
       environment:
         - TRUST_PROXY=false # true behind a reverse proxy, see below
       stop_grace_period: 30s
       restart: unless-stopped
   ```

2. Adapt it:
   - **`./projo-data:/data`**: everything projo writes (SQLite database, images, caches, application versions). It is the only folder to back up.
   - **Your media**, mounted read-only (`:ro`) under `/media`: projo never modifies, renames or moves a file. Mount as many folders as you need; you pick them later in the interface.
   - **The port**: `8080:8080` publishes projo on port 8080 of the machine. For another port, change the first number (`9000:8080`).
   - **`TRUST_PROXY`**: leave it `false` if browsers connect to projo directly. See [Behind a reverse proxy](#behind-a-reverse-proxy).
   - **`stop_grace_period: 30s`**: gives projo time to shut down cleanly (playback, running jobs).

3. Start it:

   ```bash
   docker compose up -d
   docker compose logs -f projo   # Ctrl+C to quit, projo keeps running
   ```

### User and permissions

Inside the container, projo runs as the `projo` user, **uid 1000, gid 1000**, never as root. On startup, the container hands `/data` over to that user if it does not own it already (a folder created by Docker), then drops root privileges.

Your media must be **readable by uid 1000**: check with `ls -ln /path/to/your/movies`. If it is not, make it world-readable (`chmod -R o+rX /path/to/your/movies`), or run projo as the user that owns the files:

```yaml
    user: '1001:1001' # uid:gid owning your media
```

With `user:`, nothing is changed on startup: `projo-data` must belong to that user (`sudo chown -R 1001:1001 projo-data`).

### Behind a reverse proxy

projo listens over HTTP. For access from outside with HTTPS and a domain name, put it behind a reverse proxy (Caddy, Traefik, Nginx Proxy Manager…) and set **`TRUST_PROXY=true`**.

Why: behind a proxy, projo only sees the proxy's connection. With `TRUST_PROXY=true`, it reads the `X-Forwarded-For`, `X-Forwarded-Proto` and `X-Forwarded-Host` headers sent by the proxy, and so knows:

- the real IP address of each visitor, used to rate-limit sign-in attempts and shown in the device list. Without it, everyone has the proxy's IP, and ten wrong passwords lock the whole household out;
- the public address (`https://media.example.com`), used for secure cookies and to reject requests coming from another site. Without it, projo believes it is served over `http://` and refuses to sign in (error 403).

Conversely, never enable `TRUST_PROXY` if projo can be reached without going through the proxy: anyone could then forge those headers. Only publish the port locally:

```yaml
    ports:
      - '127.0.0.1:8080:8080'
    environment:
      - TRUST_PROXY=true
```

Example with Caddy (automatic HTTPS certificate):

```
media.example.com {
	reverse_proxy 127.0.0.1:8080
}
```

With Nginx, forward `Host`, `X-Forwarded-For` and `X-Forwarded-Proto`, turn off buffering (`proxy_buffering off`, for real-time updates) and allow 10 MB uploads (`client_max_body_size 10m`, for uploaded images).

## First launch

1. Open `http://<your-machine>:8080`.
2. The wizard asks for the administrator account, then the folders of the first library: pick them in `/media`. A library can mix movies and shows.
3. The first scan starts. Files appear as the scan goes; a file that was just copied waits two minutes without changes before it is checked and shown.

Then, from the avatar menu → **Administration**: add more libraries, invite your family (**Accounts** → create an invitation, a single-use link valid for 7 days), tune playback.

## TMDB key

**Administration → Metadata → TMDB API key**: paste the API key (or the read access token, both work). projo checks it with TMDB, then retries identification of every file that was waiting. As long as no key is saved, or if TMDB rejects it, a banner and a notification say so.

Files projo cannot identify with certainty go to **To review** (see [Troubleshooting](#troubleshooting-why-a-file-does-not-show-up)). A wrongly identified title is fixed from its own page (⋮ menu → Fix the match); projo remembers it on later scans.

## Naming your files

projo renames and moves nothing: it reads the title, year and episode number from the names, then searches TMDB. Usual release names are fine (`1080p`, `x265`, `MULTi`, `VFF`, `[group]`… are ignored).

**Movies**: `Title (year)`, flat or in a folder of the same name.

```
Movies/Inception (2010).mkv
Movies/Inception (2010)/Inception.2010.1080p.BluRay.x264-GRP.mkv
Movies/Blade Runner (1982) - Director's Cut.mkv
```

**Shows**: one folder per show, one folder per season, `SxxEyy` in the name.

```
Shows/Breaking Bad (2008)/Season 01/Breaking.Bad.S01E01.mkv
Shows/Breaking Bad (2008)/Specials/Breaking.Bad.S00E01.mkv
```

- **The year** is optional, but it separates titles with the same name (`Dune (1984)` / `Dune (2021)`).
- **The title** must be TMDB's, in the library's language or the original one. Anything that is not part of it (`Harry Potter 3 And The Prisoner…`) prevents identification.
- **An id** skips the search: `Inception (2010) {tmdb-27205}.mkv`, `[imdbid-tt1375666]`, or on the show folder `Breaking Bad (2008) [tmdbid-1396]`.
- **Editions**: `{edition-Extended Cut}`, or `Director's Cut`, `Extended Edition`, `IMAX`… after a dash. Two files of the same movie are two versions of it.

A badly named file stays playable: it waits in **To review**, and an identification made by hand is remembered, even if the file is renamed or replaced.

## Updates

projo is made of two parts that update separately:

- **the application**, downloaded from the [GitHub releases](https://github.com/LeoMartinDev/projo/releases) and installed in `/data/app/`;
- **the Docker image** (the "runtime": Bun, ffmpeg, the supervisor that starts the application), which rarely changes.

### The application, from the admin

**Administration → Updates.** projo checks every day for a new version (or right away with "Check now") and shows its release notes.

"Update" downloads the version, checks the SHA-256 digest of the archive and of each of its files, installs it next to the current version, backs up the database (`/data/db/backups/projo-<previous version>.db`) then restarts on the new version. Ongoing playback resumes on its own.

If the new version does not start properly within 60 seconds, projo automatically goes back to the previous one, restores the backed-up database and reports it with a notification.

**Rolling back**: the "Versions on disk" section keeps the running version and the previous one; "Go back to this version" switches back through the same mechanism.

### The Docker image

When a new version needs a newer image, the Updates page says so ("This version needs a newer Docker image") with the command to run, and does not offer "Update" until the image is up to date. Release notes also announce each new image. From the `docker-compose.yml` folder:

```bash
docker compose pull      # or: docker pull ghcr.io/leomartindev/projo:latest
docker compose up -d
```

Updating the image does not change the application version installed in `/data`: the image ships an application version, used only on the very first start.

## Backup and restore

All of projo's state is in `/data` (`projo-data` on the machine):

```
db/projo.db        the database (accounts, progress, metadata, settings)
db/backups/        automatic backups before migrations and updates, exports
images/            posters, backdrops, uploaded images
app/               installed application versions
cache/             transcoding, thumbnails, extracted subtitles: regenerated, no need to back up
```

**Back up**:

1. **Administration → Server → Export the database**: writes a consistent copy of the database, taken without stopping projo, to `db/backups/projo-export-<date>.db`.
2. Copy `projo-data` without `cache/` with your usual tool, for example `rsync -a --exclude cache/ projo-data/ /backup/projo-data/`.

For a perfectly consistent copy without the export, stop projo (`docker compose stop`), copy `projo-data`, then start it again (`docker compose start`).

**Restore**:

1. `docker compose stop`.
2. Put the backed-up folder in place of `projo-data`. To start from an export: copy it to `db/projo.db` and delete `db/projo.db-wal` and `db/projo.db-shm` if they exist.
3. `docker compose start`. Media files are rescanned; nothing is lost as long as the paths under `/media` are the same.

## Troubleshooting: why a file does not show up

Everything can be diagnosed from the admin, without a terminal:

1. **Pending files**: the file is seen but not shown yet. The reason is given:
   - *Being written*: its size or date still changes. projo waits two minutes without changes (configurable per library, "quiet period").
   - *Unreadable*: ffprobe cannot read it, typically an MP4 whose download is not finished.
   - *Damaged*: decoding a sample fails (paused torrent, corrupted file).
   - *Too small*.

   "Check again" restarts the check. A file pending for more than 24 hours triggers a notification.
2. **To review**: the file is shown under a title taken from its name, but projo could not identify it on TMDB with certainty (movie or episode?, title not found, several possible titles, episode not found…). "Identify" searches for the right title; "Reject" sets it aside.
3. **Missing**: the file is gone from the disk (moved, deleted, disk unmounted). It comes back as it was if it returns to the same place. If a whole folder becomes unreachable, projo marks nothing as missing and sends an "unreachable folder" notification.
4. **Jobs**: background tasks (scan, analysis, identification, images…) queued, running or failed, with the error code. "Retry" to try again.
5. **Notifications** (menu badge): TMDB key missing or rejected, unreachable folder, unsupported layout, low disk space, files stuck pending, updates.

If the file is in none of these lists, projo does not see it:

- unsupported extension (supported: `mkv mp4 m4v mov avi webm ts m2ts wmv`);
- incomplete download file (`.part`, `.!qB`, `.crdownload`…) or hidden file (name starting with `.`);
- extras: `Extras`, `Trailers`, `Samples`, `Featurettes`… folders, `-trailer`, `-sample`… files (ignored in v1);
- folder containing a `.ignore` or `.nomedia` file;
- `VIDEO_TS`, `BDMV`, `.iso`: not supported (a notification says so);
- the folder is not in a library, or is not readable by uid 1000 (see [User and permissions](#user-and-permissions)).

Scans are triggered by folder watching, every 15 minutes, and on demand from the library page ("Scan", or "Full scan" to read everything again). A file visible to you but not to a family member: check the accessible libraries and the maximum content rating of their profile (**Accounts**).

As a last resort, the logs: `docker compose logs projo` (JSON, with a `code` field per error).

### Tips for downloads

- qBittorrent: enable "Append .!qB extension to incomplete files". projo ignores these files outright.
- Radarr and Sonarr: let them import finished files into the library; they arrive complete and show up within minutes.
- Without these settings, projo still detects a growing file and waits until it is stable and readable before showing it.

## Development

Requirements: [Bun](https://bun.sh) (the `packageManager` version in `package.json`), `ffmpeg`, `ffprobe` and `fpcalc` (Chromaprint) in the `PATH`.

```bash
bun install
bun run dev          # server :8080 + web :5173
bun run test         # unit and integration tests
bun lint             # lint and architecture rules
bun run typecheck
bun run e2e          # Playwright
```

Bun monorepo: `apps/server` (Hono, SQLite, scanner, streaming), `apps/web` (Vite, React), `packages/shared` (Result, error codes, API schemas), `runtime/` (Docker image, supervisor, build and release scripts, see [runtime/README.md](runtime/README.md)). Architecture rules, code layout and commands are detailed in [CLAUDE.md](CLAUDE.md); the specification is authoritative ([PRODUCT.md](PRODUCT.md)).

## Publishing a release

CI (`.github/workflows/ci.yml`) publishes on a tag, once lint, types, tests and e2e have passed on the tagged commit.

1. On an up-to-date and green `main`, bump the version in `package.json` (`"version": "X.Y.Z"`, semver) and commit: `chore(release): X.Y.Z`.
2. If the image changed since the previous release (`runtime/` except `scripts/` and tests), also bump `runtime/VERSION`, otherwise CI rejects the release. The application then requires that image (`runtimeMin`): installations will need a `docker compose pull` before they can update.
3. Tag and push:

   ```bash
   git tag vX.Y.Z
   git push origin main vX.Y.Z
   ```

CI checks that the tag matches the `package.json` version, builds and pushes the `ghcr.io/leomartindev/projo:<runtime/VERSION>` and `:latest` image if needed, then creates the GitHub release with `projo-app-X.Y.Z.tar.gz`, `manifest.json`, `SHA256SUMS` and notes generated from the commits (Conventional Commits). Installations offer it within a day.

To republish the image alone (Debian or ffmpeg security fix without an application change), tag the commit of the latest `vX.Y.Z` release with `runtime-<runtime/VERSION>`.

Only stable `vX.Y.Z` versions are published (no pre-releases).

## Credits

Metadata and images provided by [TMDB](https://www.themoviedb.org/); this product uses the TMDB API but is not endorsed or certified by TMDB. Intro and credits markers provided by [TheIntroDB](https://theintrodb.org/), [IntroDB](https://introdb.app/) and [SkipDB](https://skipdb.tv/). Naming conventions inspired by Jellyfin and Infuse.

## License

MIT.
