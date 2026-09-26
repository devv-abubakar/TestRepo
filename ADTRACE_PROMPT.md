# AdTrace — Build Prompt for Claude Code

Paste everything below the line into Claude Code, running in an empty project folder.

---

Build a production-ready Android application from scratch.

**App name:** AdTrace
**Package name:** `com.abubakar.adtrace`
**Play Store title:** AdTrace — Popup Ad Blocker & Adware Detector

## 1. What the app does

Many Android users sideload APKs from unknown sources. Some of those apps are
adware: they display popup ads over other apps, on the home screen, and on the
lock screen, and they often hide their own launcher icon so the user cannot find
which app is responsible.

AdTrace finds the responsible app and helps the user shut it down. It is a
detection and remediation tool, not a system-level ad filter.

Core value: the user can answer the question **"which app just showed me that
ad?"** and fix it in one tap.

## 2. Non-negotiable constraints — read before designing

Do not design around capabilities Android does not grant. Specifically:

- **A normal app cannot uninstall another app silently.** AdTrace must surface
  the offender and launch the system uninstall dialog; the user confirms.
- **A normal app cannot revoke another app's permissions.** AdTrace must deep-link
  the user to the correct system settings screen instead.
- **Do not request permissions the features do not need.** An app that requests
  everything looks like malware, gets flagged by Play Protect, and fails Play
  review. Every permission in the manifest must be justified by a shipped
  feature, and the justification must be written as a comment next to it.
- **`QUERY_ALL_PACKAGES` is a sensitive permission.** Play requires a declared
  justification for it. Scan functionality genuinely needs it — document why in
  the README and keep usage narrow.
- **Google Play does not allow apps whose VPN service blocks ads in other apps.**
  See section 5 for how this is handled with build flavors. Do not put the VPN
  blocker in the Play Store build.

If any requirement below turns out to be impossible on modern Android, say so
explicitly rather than implementing something that only appears to work.

## 3. Tech stack

- Kotlin, Jetpack Compose, Material 3
- MVVM: Compose UI → ViewModel → repository → data source
- Coroutines and Flow. No blocking work on the main thread.
- Room for scan history and the user's allowlist
- `minSdk 24`, `targetSdk` = current stable, view binding not needed (Compose)
- Version catalog (`libs.versions.toml`) for dependencies
- No Firebase, no analytics SDK, no ad SDK, no crash reporter that uploads the
  installed-app list

Keep the dependency list small. Justify each dependency.

## 4. Features to implement

### 4.1 Adware scanner

Enumerate installed applications and score each one for adware risk. Signals:

| Signal | How to detect | Weight |
|---|---|---|
| Can draw over other apps | `Settings.canDrawOverlays` / `AppOpsManager` for the target package | high |
| Installed from an unknown source | `PackageManager.getInstallSourceInfo` (API 30+), `getInstallerPackageName` below that | high |
| Launcher icon hidden | no launcher activity resolvable, yet the app is enabled and not a system app | high |
| Holds device admin | `DevicePolicyManager.getActiveAdmins` | high |
| Holds accessibility service access | enabled accessibility services list | high |
| Can post notifications and recently installed | package install time + notification permission | medium |
| Requests a suspicious permission combination | manifest permission list | medium |
| Is a system app | `ApplicationInfo.FLAG_SYSTEM` | lowers the score |

Produce three buckets: **Dangerous**, **Suspicious**, **Safe**. The scoring logic
must live in a pure Kotlin class with no Android dependencies so it is unit
testable, and it must be covered by unit tests including edge cases (system apps,
the app itself, disabled packages, apps with no launcher activity by design such
as input methods and wallpapers).

Scanning must be off the main thread, must report progress, and must remain
responsive with 300+ installed packages.

Let the user allowlist an app they trust. Allowlisted apps stay out of the
Dangerous bucket on later scans.

### 4.2 "Which app showed that ad?"

The user taps a button the moment an ad appears. The app reports which package
was in the foreground, using `UsageStatsManager` over a short recent window.

- Requires Usage Access, which is a settings-screen grant, not a runtime
  permission. Request it with a clear explanation of why, and handle the user
  declining.
- Show the last few foreground packages with timestamps, not just one, because
  the ad's owner may not be the very top entry.
- Offer a quick-action shortcut (a tile or notification action) so the user can
  trigger this without first opening the app, since the ad is covering the
  screen.

### 4.3 One-tap remediation

For an app the user decides to act on:

- Open that app's **Display over other apps** settings screen
- Open the app info screen
- Launch the system uninstall dialog
- Disable it, where the platform allows it for that package

OEM settings screens differ. Xiaomi (MIUI/HyperOS), Oppo/Realme (ColorOS), Vivo
(Funtouch), Samsung (One UI) and Infinix/Tecno (XOS/HiOS) do not all expose the
same intents. Try the standard AOSP intent first, then known OEM intents, then
fall back to the generic app-info screen. Never let a missing activity crash the
app — resolve the intent before launching it and show a "we could not open that
screen, here is how to get there manually" state instead.

### 4.4 Background watch (optional, off by default)

A foreground service that periodically re-checks for newly installed packages
holding the overlay permission, and notifies the user. Must:

- Be opt-in, with a persistent notification explaining what it does
- Respect Android's background and foreground-service-type rules for the current
  target SDK
- Not drain battery: no tight polling loop; use `PACKAGE_ADDED` broadcasts plus a
  periodic `WorkManager` job
- Stop cleanly, release resources, and survive configuration changes

### 4.5 DNS ad blocker — `full` flavor only

A local `VpnService` that resolves DNS and drops requests to known ad and
tracker hosts, using a bundled blocklist that updates from a URL the user can
configure.

- All filtering happens on the device. No traffic is proxied to a remote server.
- The VPN must not break connectivity when disabled or when the service dies.
- Must handle: VPN revoked by the system or another VPN app, airplane mode,
  network changes, doze, and reboot (do not auto-start without user consent).
- This feature must be excluded from the `playStore` flavor.

## 5. Build flavors

Two flavors sharing one codebase:

- `playStore` — scanner, "which app showed that ad", remediation, background
  watch. No `VpnService`, no `BIND_VPN_SERVICE` in the merged manifest. This is
  the build that goes to Google Play.
- `full` — everything including the DNS blocker. Distributed as a direct APK
  download or via F-Droid.

The flavor split must be real: use source sets so the VPN code is not compiled
into the `playStore` variant at all. Verify by checking the merged manifest of
each variant.

## 6. Permissions

Declare only these, each with an inline comment justifying it:

| Permission | Feature it serves | Type |
|---|---|---|
| `QUERY_ALL_PACKAGES` | scanner | install-time, Play-sensitive |
| `PACKAGE_USAGE_STATS` | "which app showed that ad" | special, settings screen |
| `POST_NOTIFICATIONS` | watch alerts | runtime (API 33+) |
| `FOREGROUND_SERVICE` + the specific type | background watch | install-time |
| `RECEIVE_BOOT_COMPLETED` | only if the watch is enabled | install-time |
| `BIND_VPN_SERVICE` | DNS blocker — **`full` flavor source set only** | special |
| `INTERNET` | blocklist updates — **`full` flavor only** | install-time |

Requirements:

- Request each grant at the moment the feature needs it, never all at startup
- Explain why before the system dialog appears
- Every feature must degrade gracefully when its grant is denied, and must never
  crash
- Re-check grants on resume; the user may revoke them in Settings
- Do not request storage, location, contacts, camera, microphone, phone state,
  SMS or accessibility. AdTrace does not need them. If a design idea seems to
  need one, drop the idea.

## 7. Privacy and security

- The installed-app list never leaves the device. No server, no analytics.
- No logging of package names in release builds.
- Room database stays local; no backup of the scan history to cloud backup
  (configure `data_extraction_rules` and `backup_rules` accordingly).
- Ship a privacy policy the Play listing can link to, stating plainly that the
  app reads the installed-app list locally and uploads nothing.
- The blocklist download in the `full` flavor must use HTTPS with certificate
  validation. Never disable TLS verification.

## 8. UI/UX

- Material 3, dynamic color where available, dark and light themes both correct
- Home: a single prominent **Scan** button, a device health summary, and the
  count per risk bucket
- Results: grouped by bucket, each row showing the app icon, label, install
  source, and the specific signals that raised its score — explain the verdict,
  do not just assert it
- Detail sheet per app: every signal, with the remediation actions
- Proper loading, empty, error and permission-denied states for each screen
- Urdu and English string resources, with English as the default and correct
  RTL-safe layouts
- Touch targets at least 48dp, content descriptions on icon buttons, readable
  contrast
- Never block the main thread during a scan; the UI must stay scrollable

Do not use alarming red-alert "your phone is infected" styling with fake counts.
That pattern is how cleaner-app scams look, and it will hurt both trust and
review. Be accurate and calm.

## 9. Quality bar

- No `TODO` placeholders, no stubbed functions, no mock data standing in for real
  logic
- No swallowed exceptions; every expected failure becomes a visible, recoverable
  UI state
- Lifecycle-safe: no work touching a destroyed composition or a leaked context;
  cancel coroutines with the right scope; release the `VpnService` and any
  service resources correctly
- Unit tests for the risk-scoring engine, the install-source classifier, and the
  blocklist parser
- The project must assemble: run `./gradlew assemblePlayStoreDebug
  assembleFullDebug` and `./gradlew test` and fix what fails. Do not report the
  work complete until both pass.
- A README covering: what each permission is for, the flavor split and why, how
  to build each variant, the Play Store policy reasoning, and the known OEM
  limitations

## 10. Process

1. Scaffold the project and get an empty app building on both flavors first.
2. Build the scanner and its tests before any UI polish.
3. Then "which app showed that ad", then remediation, then the background watch.
4. The DNS blocker last, in the `full` flavor only.
5. After each step, run the build and the tests, and tell me what you verified
   versus what needs a real device.

State clearly which behaviours you could not verify without installing on a
physical device, so I can test those myself. Do not claim a feature works if you
only confirmed it compiles.
