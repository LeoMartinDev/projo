# native-player: the §26.6 player prototype

`present({ url, title })` presents `AVPlayerViewController` full screen (PiP allowed, playback audio
session, `UIBackgroundModes: audio`). Launched from the dev-only route `projo://dev-player?url=…`
(`src/app/dev-player.tsx`). In Expo Go the module is absent and the screen says so.

No "Skip intro": `AVPlayerViewController.contextualActions` is tvOS 15+ / visionOS only
(`API_UNAVAILABLE(ios)` in AVKit, iOS 27.1 SDK; it does not compile for iOS), and so are
`transportBarCustomMenuItems`, `customOverlayViewController` and the info views. The system player
has no supported way to add an action on iPhone or iPad.

`dev/hls-wrap.ts` stands in for what the server will serve in slice 5: it opens a playback session
with a bearer token, keeps it alive (heartbeats at position 0: it resets that item's resume
position), and serves without auth on a port of its own a master playlist with one WebVTT rendition
per text subtitle track, proxying the session's playlist and segments with the bearer. Pick an MKV
with text subtitles (an mp4 would go `direct`); `Ctrl-C` ends the session.

## Run it

```bash
# 1. A bearer token for the server (your real one, or a throwaway one: PORT=8095 DATA_DIR=<tmp>)
curl -s -H 'Content-Type: application/json' -H "Origin: $SERVER" \
  -d '{"username":"…","password":"…","token":true,"deviceName":"prototype"}' \
  "$SERVER/api/v1/auth/login"            # → "token"; item id: GET /api/v1/movies with the token

# 2. The stream (prints the master URL and the deep link)
PROJO_SERVER=$SERVER PROJO_TOKEN=… PROJO_ITEM=<itemId> \
  bun apps/mobile/modules/native-player/dev/hls-wrap.ts 8096

# 3. The dev build (ios/ is generated and git-ignored)
cd apps/mobile
bunx expo prebuild -p ios
(cd ios && LANG=en_US.UTF-8 pod install)
```

Simulator: build the Release configuration (the JS is bundled, no Metro), install, open the link:

```bash
xcodebuild -workspace ios/projo.xcworkspace -scheme projo -configuration Release \
  -destination 'platform=iOS Simulator,name=iPad Air 11-inch (M4)' -derivedDataPath ios/build \
  CODE_SIGNING_ALLOWED=NO
xcrun simctl install booted ios/build/Build/Products/Release-iphonesimulator/projo.app
xcrun simctl openurl booted 'projo://dev-player?url=http%3A%2F%2Flocalhost%3A8096%2Fmaster.m3u8'
```

Your iPhone or iPad (free Apple ID, no paid account):

1. Xcode → Settings → Accounts: add your Apple ID (it creates a "Personal Team").
2. Open `ios/projo.xcworkspace`, target `projo` → Signing & Capabilities: Team = your Personal Team.
   If the bundle id `dev.leomartin.projo` is refused, give it a suffix there (local change only).
3. Device plugged in (or paired over Wi-Fi), Developer Mode on (Settings → Privacy & Security).
   Product → Scheme → Edit Scheme → Run → Build Configuration: **Release** (no Metro needed), then
   Run. First launch: Settings → General → VPN & Device Management → trust your Apple ID.
4. The free signature expires after **7 days**: Run again from Xcode to re-sign.
5. In Safari on the device, open `projo://dev-player`, type `http://<Mac's LAN IP>:8096/master.m3u8`
   (the device must reach the Mac; the Mac firewall must allow Bun), the intro bounds, Play.

## On-device checklist (the §26.6 decision)

"Skip intro" is settled by the SDK (see above). What only a device can show, on the **iPhone** and
on the **iPad**, with an MKV that has text subtitles:

- [ ] Plays; the subtitles menu (speech bubble) lists the renditions; picking one shows cues on time.
      `DEFAULT=YES` alone does not turn them on (the system's automatic selection follows the iOS
      Subtitles & Captioning settings): pick "On" in the menu.
- [ ] Picture-in-Picture (PiP button, or swipe home while playing): the video keeps playing and
      **the subtitles show in the PiP window**; restoring PiP brings the full-screen player back.
- [ ] Lock the screen / go home with PiP off: audio continues (background playback).
- [ ] AirPlay to an Apple TV (or AirPlay receiver): video plays on the TV **with the subtitles**,
      changing the subtitle track from the phone follows on the TV. Note it: the receiver fetches
      the URLs itself, without the app's headers (why §20 capability URLs are needed).
