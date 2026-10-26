# Reference design

Source: the "Projo — media server" design canvas (version of 2026-10-23, "UI kit v2" and onboarding revision; player menus added on 2026-10-26, drawn from the web player). The artboards are copied as is in `artboards/` (`.dc.html` format, one file per screen, `canvas.json` = index and layout). The canvas remains the editable version; after a change, copy the files here again.

The revised artboards load a stylesheet and illustrations hosted by the canvas (`/_blob/<id>`). They are copied in `artboards/blobs/` under their id:

| File | Role |
|---|---|
| `blobs/00ccc6c7bfab1fbb6e69fcb0922c4361.css` | UI kit v2: variables, surfaces, buttons, fields, switch, segmented control, choice cards, checkboxes, chips, steps, bars, motion |
| `blobs/38bbe2036d3e1ba5aeda72c8bf37a143.jpg` | `img-dunes` (Welcome) |
| `blobs/442ff390293c7116159702394c772862.jpg` | `img-mountains` (Account, kit header) |
| `blobs/add9aa3eba878fc1bfee268e6932b77b.jpg` | `img-ocean` |
| `blobs/f1cdf43c7c9ee141a49a136fdce63bdb.jpg` | `img-city` (Server) |
| `blobs/b67000ecd3933ddff98d563a346d9f42.jpg` | `img-forest` (Profiles) |
| `blobs/c95a4d2938c53388f1dfc29bfa3df2b3.jpg` | `img-lighthouse` (Library) |

The application ships 1600 px WebP versions of them in `apps/web/src/shared/backdrops/` (strict CSP, no external domain).

This folder is projo's **visual source of truth** (see PRODUCT.md §19). A screen that is not in it is built with the same tokens and components.

The artboards are in French, the reference language of the interface; labels below are given in English.

## Inventory

| Artboard | Screen | Spec section |
|---|---|---|
| `Main.dc.html` | Profiles — "Who's watching?" (initial + colour avatars, PIN padlock, Add, Manage profiles) | §13.6, §14 |
| `Home.dc.html` | Home: pill nav Home · Shows · Movies · My list, search, hero with video and sound preview, Continue watching, Up next, Recently added and My list rows, cards with hover actions | §13.2, §13.3 |
| `Series.dc.html` | Show page: Resume, My list, From the beginning, underlined season tabs, episode list with progress, Mark all as watched | §13.5 |
| `Player.dc.html` | Player: bar with segment zones, controls, "Skip intro" with an 8 s bar, Undo toast | §10.7, §12.4 |
| `PlayerNext.dc.html` | Player, end of episode: shrunk video, next episode card, Next episode / Watch the credits | §10.7, §12.4 |
| `PlayerChapters.dc.html` | Player — Chapters menu: list with start times, the current chapter highlighted | §10.7 |
| `PlayerSpeed.dc.html` | Player — Speed menu: the speed in large, slider on four steps (0.5×, 1×, 1.5×, 2×) in a card, steps as chips | §10.7 |
| `PlayerQuality.dc.html` | Player — Quality menu: Version (when the item has several) then Quality (Original, 1080p, 720p, 480p) | §7.7, §10.2 |
| `PlayerLanguages.dc.html` | Player — Subtitles and audio, wide: two columns, tags (Forced, SDH, Image) and details, size and delay card under the subtitles, subtitles shown beside the menu | §10.4, §10.7 |
| `MobilePlayerLanguages.dc.html` | Mobile — Subtitles and audio, compact: Audio / Subtitles tabs sharing the height of the longer, size and delay side by side | §10.7, §26 |
| `AdminLibraries.dc.html` | Admin — Libraries: one card per library, Resync, Recent activity | §15 |
| `AdminAddLibrary.dc.html` | Admin — Add a library: name, content type, folders, analysis options, language, country, profiles with access | §7.1, §15 |
| `AdminAccounts.dc.html` | Admin — Accounts: list of profiles, role, colour, maximum rating, preferences, PIN | §14, §15 |
| `MobileHome.dc.html` | Mobile — Home: floating bottom bar, hero, rows, long-press action sheet, filters | §13.2, §13.3 |
| `MobileSeries.dc.html` | Mobile — Show page | §13.5 |
| `OnbWelcome.dc.html` | Onboarding 1 — Welcome: full-screen illustration (Ken Burns), giant title, Get started, Restore a backup, language picker, server status banner | §15 |
| `OnbAccount.dc.html` | Onboarding 2 — Administrator account: first name, username, password with strength meter and eye, confirmation, Stay signed in | §14, §15 |
| `OnbServer.dc.html` | Onboarding 3 — Server: name, interface language, metadata language, hardware transcoding, remote access, automatic updates | §15, §16 |
| `OnbLibrary.dc.html` | Onboarding 4 — First library: content type as illustrated cards, name, detected folders to tick, Browse…, Later / Add | §7.1, §15 |
| `OnbProfiles.dc.html` | Onboarding 5 — Profiles: admin profile, adding Adult / Kid profiles | §14 |
| `OnbReady.dc.html` | Onboarding 6 — All set: scrolling poster wall, animated check mark, analysis progress, Open projo / Go to administration | §15 |
| `Components.dc.html` | UI kit v2: buttons, fields, controls, choice cards | §19 |

The player menus are drawn from the web player as built (`apps/web/src/features/player/PlayerMenus.tsx`, `player.css`): one button per menu in the controls row (chapters when the file has some, speed, quality when there is a choice, subtitles and audio, Picture-in-Picture), smoked glass menus (`blur(44px) saturate(180%) brightness(.58)` over a dark gradient), radius 22 (28 for the wide subtitles menu), a check on the chosen option. `Player.dc.html` still shows the earlier row with a single "Subtitles and audio" button.

## What the application keeps from the onboarding flow

The first launch follows PRODUCT.md §15: **no settings**, two steps. The application keeps Welcome → Account (step 1 of 2) → First library (step 2 of 2) → All set, with the layout, illustrations and components of the artboards. Differences:

- `OnbServer` (server name, languages, transcoding, remote access, updates) and `OnbProfiles` are not steps: these settings live in the admin. On `OnbLibrary`, the content type is not asked (library in `auto`).
- `OnbWelcome`: no language picker (a setting; the language follows the browser), no "Restore a backup", no "Documentation", no server status banner (no matching API).
- `OnbAccount`: no "Stay signed in" switch (the session is always persistent), no "Help" link. Password of at least 12 characters (spec), not 10.
- `OnbLibrary`: no "detected" folders (no detection API); folders picked with the file browser show as ticked rows. No size or video count per folder.
- `OnbReady`: a single task, "Looking for videos" (no posters or intros in M1); the wall uses the illustrations without made-up titles; no mention of the TV app.
- Eyebrows and explanation paragraphs removed (AGENTS.md: no secondary labels).

## Tokens

- **Font**: Geist (400, 500, 600, 700); Geist Mono for paths, sizes and counters in the admin.
- **Background** `#0A0A0B`; surfaces `#111113`, `#141416`; glass `rgba(255,255,255,.04 to .16)` + `backdrop-filter: blur(20 to 40px) saturate(160 to 170%)`; borders drawn as inset shadows `rgba(255,255,255,.06 to .1)`, hover `.17`, focus `.6` + halo `0 0 0 5px rgba(255,255,255,.07)`.
- **Text** `#F4F4F5`; `--fg2` `#A1A1AA`; `--fg3` `#8B8B94`; `--fg4` `#5F5F68` (placeholders); in-betweens `#C4C4CC`, `#D4D4D8`, `#E4E4E7`.
- **Accent** `#F4F4F5` by default (monochrome), suggested variants `#7C83FF`, `#FF5A5F`, `#3DDC97`; success `#3DD68C`; error `#FCA5A5` on `rgba(248,113,113,.08)`.
- **Avatars**: Blue `#5B7FA6`, Terracotta `#A86A55`, Sage `#5E8C72`, Purple `#7D6AA6`, Honey `#B08A3E`, Slate `#5F6670`.
- **Radii**: 999 px pills, switches and round buttons; 28 px panels; 20 px choice cards; 18 px tiles; 16 px large buttons; 15 px fields and segmented control; 14 px buttons and rows; 11 px small buttons; 10 px thumbnails; 7 px checkboxes; 30 px avatars.
- **Sizes**: buttons 48 px (small 36, large 56), fields 58 px with an inner label, switch 48 × 28, touch targets ≥ 44 px. Onboarding titles `clamp(44px, 5vw, 68px)`, home title `clamp(56px, 8vw, 112px)`, `letter-spacing` −0.05 to −0.055em.
- **Motion**: `--ease: cubic-bezier(.2,.7,.2,1)`, `--spring: cubic-bezier(.34,1.56,.64,1)`; `rise` entrance 0.9 s (16 px) staggered by 80 ms (`.r1` to `.r6`); 32 s Ken Burns on illustrations; poster wall scrolling in 80 s; `prefers-reduced-motion` turns everything off.
- **Formats**: 2:3 posters, 16:9 thumbnails, full-screen hero with left and bottom gradient.

## Components (kit v2)

| Component | Description | In the app |
|---|---|---|
| Panel | dark glass `rgba(18,18,21,.58)`, 40 px blur, radius 28, inner rim and large drop shadow | `.panel` (onboarding, sign-in), dialogs and menus in a more opaque version |
| Tile | surface `rgba(255,255,255,.04)`, radius 18, inner rim | `.well` (folder lists, file browser) |
| Primary button | raised white gradient, sheen sweeping on hover, 1 px lift, sliding arrow | `.button--primary`, `.button__arrow` |
| Glass / quiet / danger button | blurred glass; text only that brightens; red tint | `.button--glass`, `.button` (default), `.button--danger`; sizes `--small`, `--large` |
| Field | 58 px box, icon, inner label above the value, focus halo, error state, check mark drawn when valid, eye for passwords | `Field`, `ValidMark`, `RevealButton` (`shared/ui/controls.tsx`), `.field` |
| Select | same template as the field, chevron | `Field` + `SelectChevron` |
| Strength meter | four segments filling up | `.meter` |
| Switch | 48 × 28 track, raised knob springing across, white track when on | `Switch`, `.setting` (label + description) |
| Segmented control | glass indicator sliding with a spring | `.seg` (catalogue sort) |
| Choice card | 2 px white rim and ticked badge when chosen, optional illustration | `.choice` (content type in the admin, without illustration) |
| Check row | 22 px box filling up, drawn check mark | `Checkrow` (onboarding folders, hidden folders of the file browser) |
| Profile chips | avatar + name, dimmed when not chosen | not used yet (profiles with access, M2) |
| Steps | 26 px bars, the current one 48 px and filling up | `.steps` |
| Progress bar | 4 px, sheen scrolling while in progress | `<progress class="bar">`, `.bar-live` |

## Differences between the design and the spec, settled in PRODUCT.md

- The design groups library access, maximum rating and preferences **per profile**: the spec follows the design (access and rating per profile, not per account).
- The design's "Accounts" screen lists profiles with a role each; the spec keeps accounts (login, role) that hold profiles, so the screen shows accounts expanded with their profiles. To be adjusted in the design.
- "Content type" offers Movies, Shows, Home videos: the spec replaces it with Auto (mixed), Movies, Shows. "Home videos" is out of scope.
- The design has no genre rows on the home page: the spec removed them.
- The design separates "Continue watching" (in progress) and "Up next" (next episodes): the spec follows the design.
- The hero has a video preview with sound: added to the spec (`preview_clip` job).
- Avatars are initials on a coloured tile: the spec drops the image bank.
- The design's onboarding has six screens including settings (server, content type, profiles): the spec keeps a first launch without settings (see above).
- The movie player, search, sign-in, profile settings and the other admin sections are not drawn: to be built with the same components.
