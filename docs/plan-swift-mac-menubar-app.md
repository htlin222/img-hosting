# img-hosting Mac menubar app — plan

## Context

The img-hosting Worker already serves a working web UI at
`https://upload-image.hsiehting.com/` (Cloudflare Access OAuth) and a
bash CLI at `~/bin/img-hosting`. Daily uploads still require the user
to either open a browser tab and drag a file in, or shell out to the
CLI. Neither is a native Mac workflow — there's no hotkey for "capture
region, upload, paste URL", no drag onto a menubar icon, no system
notification on success, and the OAuth sign-in screen has to be
re-discovered through bookmarks each time.

This plan delivers a Swift menubar app that does everything the web
UI does (1:1), authenticates via the same Cloudflare Access OAuth flow
that already gates the web UI, and adds four Mac-native conveniences
the web can't reasonably do.

## Goals

- **1:1 web parity.** Every behavior in `src/ui.ts` is reproducible in
  the menubar app — drop / paste / pick, optional title/description,
  preview, URL/Markdown/HTML/deletehash outputs with click-to-copy,
  auto-copy URL on success, error surfaces, identity badge, sign-out.
- **Native Mac conveniences** added in v1:
  1. Global hotkey → `screencapture -i` → upload → URL on clipboard +
     notification.
  2. Drop files directly on the menubar icon.
  3. Recent uploads list (last 10) inside the popover.
  4. macOS notification on every successful upload, with a Copy URL
     action.
- **Auth via Cloudflare Access** — same OAuth IdP the user already
  signs in with on the web. Cookie obtained via WKWebView on first
  launch, persisted in macOS Keychain, attached to URLSession calls.
- Lives in **`macos/`** inside the existing `htlin222/img-hosting`
  repo — no new repo to keep in sync.

## Non-goals (v1)

- No notarized release / Homebrew tap. Dev-signed build is enough for
  daily personal use. Notarization is v1.1 once the API + UX settle.
- No bypass-API-key path. If the Access cookie expires, the user
  re-signs in via the embedded WebView. API-key login lives only in
  the CLI / agents (different audience, different machine model).
- No Windows / Linux client. The CLI already covers them.
- No in-app image editing / annotation. That's CleanShot's job; the
  user keeps using CleanShot before sending the file here.
- No iOS / iPad share-extension. Out of scope for v1.

## Architecture

```
macos/
├── img-hosting.xcodeproj/                  Xcode-managed project
├── img-hosting/
│   ├── ImgHostingApp.swift                 @main App; MenuBarExtra entry
│   ├── ContentView.swift                   Popover root (320×~520 pt)
│   ├── Views/
│   │   ├── DropZoneView.swift              Hero drop / paste / pick zone
│   │   ├── UploadResultView.swift          URL / MD / HTML / deletehash rows
│   │   ├── RecentsListView.swift           Scrollable list of /3/account/me/images
│   │   ├── StatusBannerView.swift          Mac-native ✓ / ⚠ / ✕ + system colors
│   │   ├── SettingsView.swift              Hotkey, sign-out, about
│   │   └── SignInWebView.swift             NSViewRepresentable WKWebView
│   ├── State/
│   │   ├── AppState.swift                  @MainActor ObservableObject
│   │   └── RecentsStore.swift              In-memory cache; refresh on popover open
│   ├── API/
│   │   ├── ImgHostingClient.swift          async URLSession-based client
│   │   ├── Models.swift                    UploadResponse, ImageMetadata, Envelope
│   │   └── Endpoints.swift                 Centralized URL builders
│   ├── Auth/
│   │   ├── AccessCookieStore.swift         HTTPCookieStorage + Keychain persistence
│   │   ├── KeychainAccess.swift            Tiny wrapper around SecItem*
│   │   └── SignInWindowController.swift    NSWindowController hosting SignInWebView
│   ├── Capture/
│   │   ├── ScreenCaptureService.swift      Runs /usr/sbin/screencapture -i
│   │   └── MenuBarDropTarget.swift         NSStatusItem + NSDraggingDestination
│   ├── Hotkey/
│   │   └── HotkeyManager.swift             Wraps Sindre Sorhus' KeyboardShortcuts
│   ├── Notifications/
│   │   └── NotifyService.swift             UNUserNotificationCenter banner + action
│   ├── Resources/
│   │   ├── Assets.xcassets
│   │   │   ├── AppIcon.appiconset
│   │   │   └── MenuBarIcon.imageset        Template image (monochrome SF Symbol)
│   │   └── Info.plist
│   └── img_hosting.entitlements            Hardened runtime + network client
├── Package.resolved
├── Makefile                                build / run / archive / clean
└── README.md                               Subproject install + dev guide
```

### Dependencies

- **KeyboardShortcuts** (https://github.com/sindresorhus/KeyboardShortcuts,
  via Swift Package Manager) — battle-tested, SwiftUI-native settings
  view for the global hotkey. Sole external dep.
- Everything else is native Apple SDK: SwiftUI, AppKit (for
  NSStatusItem & WKWebView bridges), URLSession, UNUserNotificationCenter,
  Security framework (Keychain).

### Auth flow (Cloudflare Access via WKWebView)

1. First launch → `AppState.identity == nil` → `SignInWindowController`
   opens a 700×900 modal-ish NSWindow hosting `SignInWebView`.
2. WebView loads `https://upload-image.hsiehting.com/`.
3. Cloudflare Access redirects to `htlin.cloudflareaccess.com` IdP
   chooser; user picks Google / Email PIN / etc.; user authenticates;
   Cloudflare sets `CF_Authorization` cookie on `upload-image.hsiehting.com`
   and redirects back.
4. When the final navigation lands on
   `https://upload-image.hsiehting.com/` (no further redirect),
   `webView(_:didFinish:)` fires.
5. We pull cookies for `upload-image.hsiehting.com` from
   `WKWebsiteDataStore.default().httpCookieStore`, find `CF_Authorization`,
   save it to **macOS Keychain** under service `com.hsiehting.img-hosting`
   account `cf-authorization`.
6. We also inject that cookie into the shared `HTTPCookieStorage` used
   by our app's URLSession via a `URLSessionConfiguration` with
   `httpCookieStorage = .shared` and `httpCookieAcceptPolicy = .always`.
7. SignInWindow closes. `AppState.identity = ...` (parsed from
   `GET /whoami`).
8. All subsequent API calls go through URLSession; the cookie rides
   along automatically because `httpShouldHandleCookies = true`.
9. On any 302-to-cloudflareaccess.com response (cookie expired),
   `ImgHostingClient` notifies AppState which reopens the sign-in window.

The Keychain copy exists so the cookie survives `WKWebsiteDataStore`
clears between launches. On launch we read it from Keychain, seed
`HTTPCookieStorage.shared`, then call `/whoami` to validate before
showing the UI.

### API client

All requests against `https://upload-image.hsiehting.com` (Access-gated).
Public image URLs returned by the Worker still point at the workers.dev
hostname because `PUBLIC_BASE_URL` is configured that way — the Mac app
just uses whatever `link` the API returns; no client-side rewriting.

Methods on `ImgHostingClient`:

```swift
func whoami() async throws -> Identity
func upload(_ data: Data, filename: String?, title: String?,
            description: String?) async throws -> UploadResponse
func listRecents(limit: Int = 10) async throws -> [ImageMetadata]
func delete(deletehash: String) async throws
```

All async/throws. Errors decode the `{ data: { error }, success, status }`
envelope into a typed `ImgHostingError`.

## Feature scope (v1)

### Web-parity features

| # | Behavior | Implementation hook |
|---|---|---|
| 1 | Drag-and-drop files onto the drop zone | `DropZoneView` + `.onDrop(of: [.image], …)` |
| 2 | Click drop zone → native file picker | `.fileImporter(isPresented:, allowedContentTypes: [.png, .jpeg, .gif, .webP])` |
| 3 | Paste from clipboard inside the popover | `NSPasteboard.general` + ⌘V binding |
| 4 | 20 MiB client-side size cap | Pre-check before POST, error banner if exceeded |
| 5 | Optional `title` / `description` text fields | Two `TextField`s above the drop zone |
| 6 | Auto-clear title/description after success | `appState.resetMetadata()` in upload success |
| 7 | Image preview (max 360 pt, checkerboard bg) | `AsyncImage(url: result.link)`; checkerboard via `Canvas` |
| 8 | URL / Markdown / HTML / deletehash rows | `UploadResultView` ForEach over rows |
| 9 | Per-row Copy button → NSPasteboard | `Button` calls `pasteboard.clearContents()` + `setString(:forType: .string)` |
| 10 | "Copied" feedback for 1.2 s | `@State var copiedRow: Row?`; reset via `Task.sleep` |
| 11 | Auto-copy URL on success | Done in `upload(:)` success handler |
| 12 | Status banner: uploading / success / error | `StatusBannerView` with `.statusIndicator` symbol set |
| 13 | Identity badge: email or "bearer" | Top-right of popover; reads `appState.identity` |
| 14 | Sign-out | Clears Keychain + cookies + AppState; reopens sign-in window |
| 15 | Markdown alt-text cleanup `[\\[\\]\\\\]` | Replicated verbatim |
| 16 | Re-auth on 401 | `ImgHostingClient` throws `.unauthorized`; AppState reopens sign-in |

### Mac-native additions

| # | Feature | Implementation hook |
|---|---|---|
| N1 | Global hotkey → region capture → upload → URL on clipboard | `KeyboardShortcuts.Name(.captureAndUpload)`; default ⌃⇧⌘U. On press: `ScreenCaptureService.captureRegion()` → temp file → `client.upload()` → copy URL → notification. |
| N2 | Drop files onto the menubar icon | `MenuBarDropTarget` registers a custom `NSStatusItem` button view conforming to `NSDraggingDestination`; drop → upload → notification |
| N3 | Recent uploads list (last 10) | `RecentsListView`; populates on popover open via `client.listRecents()`; each row: thumbnail + filename + ⌘C copy + ⌫ delete |
| N4 | Native notifications | `NotifyService.deliver(.uploaded(url))` after every successful upload; default action "Copy URL"; secondary "Open in Browser" |

### Settings (`SettingsView`)

- **Hotkey:** Reusable `KeyboardShortcuts.Recorder(for: .captureAndUpload)`.
- **Worker URL:** Read-only display (`https://upload-image.hsiehting.com`),
  baked into Info.plist for v1 — single-user app, no need to make it
  configurable yet.
- **Sign out:** button — clears everything, reopens sign-in.
- **Open Worker in browser:** opens the URL for debugging.
- **Version:** from Info.plist.
- **Source:** link to https://github.com/htlin222/img-hosting.

## Implementation phases

Sequenced so each phase is independently runnable and verifiable.

### Phase 0 — Scaffolding
- Create `macos/img-hosting.xcodeproj` via Xcode 16 (or programmatically
  via `xcodegen` if user prefers). SwiftUI App template, macOS 14.0
  deployment target.
- Bundle ID `com.hsiehting.img-hosting`.
- Add `KeyboardShortcuts` SPM package.
- Add entitlements: Hardened Runtime, Outgoing Network Connections.
- `Makefile` targets: `mac-build`, `mac-run`, `mac-archive`, `mac-clean`.
- README in `macos/` with build instructions.

### Phase 1 — Auth (the hardest)
- `KeychainAccess` minimal wrapper.
- `AccessCookieStore` — persist / load `CF_Authorization`.
- `SignInWindowController` + `SignInWebView` (WKWebView in NSViewRepresentable).
- Cookie harvesting in `webView(_:didFinish:)` when URL ==
  `upload-image.hsiehting.com/`.
- Bidirectional sync between `WKWebsiteDataStore.default().httpCookieStore`
  and `HTTPCookieStorage.shared` so URLSession sees it.
- `ImgHostingClient.whoami()` round-trip succeeds → AppState transitions
  to `.signedIn(identity)`.

**Verification:** App launches → web view opens → real Google sign-in
→ window closes → `/whoami` returns email → main popover renders.

### Phase 2 — Menubar + popover shell
- `ImgHostingApp` declares `MenuBarExtra("img-hosting",
  systemImage: "photo.on.rectangle") { ContentView() }` with
  `.menuBarExtraStyle(.window)`.
- ContentView shows StatusBannerView, DropZoneView, optional title/desc
  inputs, identity badge, settings cog.
- Empty UploadResultView shows placeholder.

**Verification:** Icon in menubar; click → popover opens with the
shell; click identity badge → settings; sign-out works.

### Phase 3 — Upload paths (drop / pick / paste)
- `DropZoneView` with `.onDrop`, `.fileImporter`, and ⌘V handler.
- `ImgHostingClient.upload()` wired up.
- StatusBannerView reflects upload progress + result.
- UploadResultView renders the four rows + copy buttons.

**Verification:** Drag a PNG in → URL appears → clipboard contains URL
→ pasting it into Safari opens the image.

### Phase 4 — Recents
- `RecentsListView` lazy-fetched on popover open.
- Each row: thumbnail (AsyncImage with cache), filename, copy, delete.
- Optimistic delete — row disappears, undo via toast if `delete()`
  fails.

**Verification:** Upload 3 things → close & re-open popover → all 3 in
recents → delete one → it's gone both locally and via `count`.

### Phase 5 — Global hotkey + screen capture
- `ScreenCaptureService.captureRegion()` → spawn
  `/usr/sbin/screencapture -i /tmp/img-hosting-<uuid>.png`.
- `HotkeyManager.bindCaptureAndUpload()` calls it on hotkey trigger,
  then `client.upload()`, then `NSPasteboard.general` copy, then
  `NotifyService.deliver`.
- Hotkey configurable in Settings.

**Verification:** Press ⌃⇧⌘U → region selector → drag area → image is
uploaded → notification fires → URL on clipboard.

### Phase 6 — Menubar-icon drop target + notifications polish
- `MenuBarDropTarget` — custom NSView on the NSStatusItem button that
  conforms to NSDraggingDestination for `.fileURL`.
- Drop → upload → notification with Copy URL action.
- `NotifyService` request authorization on first launch.

**Verification:** Drag a file from Finder onto the menubar icon → no
popover needed → notification with copied URL.

### Phase 7 — Polish + readme
- Dark / light mode parity (SwiftUI handles most; preview frame needs
  manual touch).
- Empty-state and error-state copy.
- README in `macos/` with screenshots.
- Update root `README.md` adding a "Mac app" section linking to it.

## Critical files (new)

All paths relative to repo root.

| File | Purpose |
|---|---|
| `macos/img-hosting.xcodeproj/` | Xcode project — bundle ID, schemes, entitlements link |
| `macos/img-hosting/ImgHostingApp.swift` | `@main` App + MenuBarExtra |
| `macos/img-hosting/ContentView.swift` | Popover layout |
| `macos/img-hosting/State/AppState.swift` | Observable state, identity, status |
| `macos/img-hosting/State/RecentsStore.swift` | Recents cache + refresh |
| `macos/img-hosting/API/ImgHostingClient.swift` | URLSession-based API |
| `macos/img-hosting/API/Models.swift` | Codable models for the Imgur envelope |
| `macos/img-hosting/API/Endpoints.swift` | URL builders |
| `macos/img-hosting/Auth/SignInWindowController.swift` | NSWindow for sign-in WebView |
| `macos/img-hosting/Auth/SignInWebView.swift` | WKWebView NSViewRepresentable |
| `macos/img-hosting/Auth/AccessCookieStore.swift` | Cookie harvest + Keychain persist |
| `macos/img-hosting/Auth/KeychainAccess.swift` | Thin SecItem wrapper |
| `macos/img-hosting/Capture/ScreenCaptureService.swift` | screencapture CLI shell-out |
| `macos/img-hosting/Capture/MenuBarDropTarget.swift` | NSStatusItem drop accept |
| `macos/img-hosting/Hotkey/HotkeyManager.swift` | KeyboardShortcuts wiring |
| `macos/img-hosting/Notifications/NotifyService.swift` | UNUserNotificationCenter |
| `macos/img-hosting/Views/DropZoneView.swift` | Drop + paste + pick UI |
| `macos/img-hosting/Views/UploadResultView.swift` | Output rows + copy |
| `macos/img-hosting/Views/RecentsListView.swift` | Recents list |
| `macos/img-hosting/Views/StatusBannerView.swift` | Status banner |
| `macos/img-hosting/Views/SettingsView.swift` | Preferences |
| `macos/img-hosting/Resources/Assets.xcassets/MenuBarIcon.imageset/` | SF-symbol-style template image |
| `macos/img-hosting/Resources/Info.plist` | LSUIElement = YES (menubar app, no Dock) |
| `macos/img-hosting/img_hosting.entitlements` | Network client + hardened runtime |
| `macos/Makefile` | Build / run / archive / clean |
| `macos/README.md` | Subproject docs |

### Files to **modify** (server side, none required)

The Worker is feature-complete for this client. No changes needed.

### Files to update (docs)

- Root `README.md` and `README.zh-TW.md`: add a "Mac menubar app"
  section under the existing "Web UI" section.
- Root `Makefile`: add `mac-build` / `mac-run` / `mac-archive` /
  `mac-clean` that cd into `macos/` and call its Makefile.
- Root `.gitignore`: add `macos/build/`, `macos/DerivedData/`,
  `macos/.build/`, `*.xcuserstate`, `*.xcuserdatad/`.
- `CLAUDE.md`: add a "Mac app" section noting that the same Worker is
  the backend and the auth flow is Access-only (no API-key path in
  the Mac client).

## Reused existing pieces

- The Worker (no code changes). All endpoints already exist:
  `POST /3/image`, `GET /3/account/me/images`,
  `DELETE /3/image/:deletehash`, `GET /whoami`,
  `GET /i/:filename`.
- `PUBLIC_BASE_URL` is already set so returned `link` values point at
  the workers.dev host — the Mac app uses them verbatim, no rewriting.
- Cookie-based auth (`CF_Authorization`) is what `/3/*` already
  validates via `src/access.ts`.
- The Imgur-shaped envelope (`{ data, success, status }`) is what
  `src/response.ts` produces — `API/Models.swift` decodes it the same
  way the web UI's JS does.

## Verification plan (end-to-end)

After each phase, hit these in order. All must pass before merging
into `main`.

1. **App launches; menubar icon appears.** `pgrep img-hosting` returns
   a PID; icon visible in `defaults read com.apple.menuextra`.
2. **First-run sign-in works.** Delete Keychain entry → relaunch →
   WebView opens → sign in with Google → window closes → identity
   badge shows email.
3. **Drag-drop upload.** Drag `~/Desktop/test.png` into popover →
   StatusBannerView shows `uploading test.png…` → switches to
   `uploaded · 1024×768 · 152 KiB` (green) → URL on clipboard → paste
   into Safari renders the image.
4. **All 4 outputs.** All four rows populated; clicking each Copy
   button writes the right format to clipboard; "Copied" pulse lasts
   ~1.2 s.
5. **Paste from clipboard.** ⌘C an image in another app → bring up
   popover → press ⌘V → image uploads.
6. **File picker.** Click drop zone → file picker filters to image
   types only.
7. **20 MiB cap.** Try uploading a 25 MiB JPG → error banner before
   any network call.
8. **Recents.** Upload 3 things → close & reopen popover → all 3 in
   recents → delete the middle one → count drops to 2 both locally
   and via `GET /3/account/me/images/count`.
9. **Global hotkey.** Press ⌃⇧⌘U → region selector → upload → URL on
   clipboard → notification banner.
10. **Drop on menubar icon.** Drag file from Finder onto the menubar
    icon → upload completes without opening popover → notification.
11. **Re-auth on expiry.** Manually expire the cookie (DELETE Keychain
    entry, restart) → any API call triggers sign-in window reopening.
12. **Sign out clears everything.** Settings → Sign Out → Keychain
    empty → relaunch shows sign-in.
13. **Notarized-style hygiene checks.** `codesign -dvv build/...app`
    shows entitlements; Console.app shows no sandbox violations during
    a full session.
14. **Existing Worker tests still pass.** `make test` in repo root
    runs the 20 Vitest specs against unchanged server code.

## Open risks / future work

- **Cookie longevity.** Cloudflare Access session duration was set to
  24 h. Re-sign-in once a day is fine for personal use; revisit if it
  becomes annoying.
- **WKWebView + URLSession cookie sync.** Apple's APIs don't guarantee
  perfect parity between the two cookie stores; we handle the most
  common case (set in WebView, read in URLSession) but may need to
  poll cookie store on app activation if Cloudflare rotates the cookie.
- **Hardened Runtime + screencapture.** Spawning
  `/usr/sbin/screencapture` requires the
  `com.apple.security.temporary-exception.shell-script` entitlement
  *or* dropping the hardened runtime for dev builds. v1: dev build
  without hardened runtime; v1.1: switch to ScreenCaptureKit + screen
  recording permission prompt.
- **Notarization.** Deferred to v1.1. Requires Apple Developer Program
  ($99/yr). Until then, dev-signed build runs on this Mac only.
- **No tests in v1.** Swift app gets manual verification (see plan
  above). Adding XCTest UI tests is v1.1 work.
- **Single user assumption** baked into Worker (`owner = 'me'`) — Mac
  app inherits this, ok for personal use.

## Distribution

- **v1:** `make mac-archive` produces a `.app` bundle in
  `macos/build/img-hosting.app`. Copied to `/Applications/` manually.
  Signed with the user's "Apple Development" identity (Personal Team
  or paid Developer Program — either works).
- **v1.1 (future):** Notarize via `notarytool`, distribute via a
  GitHub Release artifact + a Homebrew Cask in
  `htlin222/homebrew-tap`. Not in scope for v1.
