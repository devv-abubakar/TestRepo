# Knotlo: Mega Prompt for Claude Code

Copy everything below the line into Claude Code, opened inside your new Android Studio project
(an "Empty Activity" Compose project, package `com.abubakar.knotlo`). Before you paste it, copy the
mockup images (`android-mockup/*.png` from this repo) into the project at `docs/design/`.

---

You are a senior Android game developer. Build **Knotlo: Arrow Puzzle Escape**, a complete,
release-ready, offline Android puzzle game in this existing Kotlin + Jetpack Compose project.
Work autonomously from start to finish. Do not ask questions. Do not leave TODOs, stubs or placeholder screens.

## 0. Ground rules
- Keep the existing package name (`com.abubakar.knotlo`), project and Gradle version catalog. Add dependencies through `libs.versions.toml`, using stable versions that work with the project's AGP and Kotlin versions. Never downgrade.
- Use Kotlin only, a single Activity, Compose with Material 3, MVVM with StateFlow, and coroutines. Use manual DI with one `AppContainer` (no Hilt).
- Allowed extra dependencies: navigation-compose, lifecycle-viewmodel-compose, datastore-preferences, kotlinx-serialization-json, core-splashscreen, material-icons-extended, and play-review-ktx. Add nothing else.
- Everything must be original: no copied names, art, fonts, sounds or levels from other games. Use the system font (Roboto). Generate sounds in code.
- Match the reference mockups in `docs/design/` (home screen, game screen, blocked state, win sheet, shape levels).
- Keep files small and focused (under about 300 lines). Put every user-visible string in `strings.xml`.
- Track progress in `PROGRESS.md` as a checklist of the phases below. If your context resets, read it and continue.
- After every phase, run `./gradlew testDebugUnitTest assembleDebug`, fix every error and warning you introduced, then commit with a clear message.

## 1. Game rules (engine, pure Kotlin, no Android imports, fully unit-tested)
- The board is a W×H grid. An **arrow** is a polyline of 2 or more orthogonally adjacent cells. Its last cell is the **head**, and the head points in the direction of the last segment. Arrows never overlap.
- When the player taps an arrow, look at its **exit ray**: every cell from the head to the board edge in the head's direction.
  - If the ray is clear, the arrow slides out like a snake (the body follows the head along its own path, then along the ray) and is removed.
  - If another arrow is on the ray, it is **blocked**. The arrow slides forward until it touches the blocker, turns red, and snaps back. The blocker shakes, the phone vibrates strongly, and the player loses 1 heart.
- The level is won when no arrows are left. It is lost when hearts reach 0.
- The player starts with 3 hearts (level 100 has 2). Stars are awarded as follows: 3★ for no mistakes and no hints, 2★ for at most 1 mistake, otherwise 1★.
- **Undo** restores the last removed arrow (free, up to 3 per level). **Hint** pulses one free arrow and its exit ray. The player starts with 3 hints, and each extra hint costs 40 coins.

## 2. Level generator (pure Kotlin, deterministic, seeded)
- **Construction rule (this is what guarantees solvability):** place arrows one at a time. Each new arrow's exit ray must not cross any earlier arrow or its own body. Removing arrows in reverse placement order then always works.
- **Placement:** go through mask cells in centre-first order (Chebyshev distance from the centre, normalised, plus random jitter of 0.15). For each free cell, try 16–26 random self-avoiding walks (continue straight with probability 0.55, length within the level's range) in both orientations. Shorten each walk from the head until its ray is clear, and require length ≥ 2.
- **Scoring each candidate:** `score = length + hardness*(14*blockedFreeArrows + 1.5*min(rayLen,12) - (rayLen<2 ? 40 : 0))`, where `blockedFreeArrows` is the number of earlier, still-free arrows whose exit ray this candidate covers. Keep the highest-scoring candidate. Make 3 passes so gaps get filled.
- **Verification and metrics:** after generating, repeatedly remove every free arrow in rounds. This must clear the board; if it does not, that is a bug. Record the number of arrows, the arrows free at the start, the number of rounds, and the fill percentage. If a level misses its target metrics, retry with salted seeds (up to 30 attempts) and keep the best attempt.
- **Shapes:** write a pure-Kotlin vector shape DSL in a 100×120 design space. It needs `circle`, `ellipse(rot)`, `rect`, `roundRect`, `polygon`, and `stroke(polyline, width)` primitives, combined as `union` minus `cut` (holes for eyes, windows and similar). Test whether a point is inside a shape with plain math. Crop the shape to its bounding box, then sample each grid cell's centre to build the mask. The grid height follows the shape's aspect ratio.
- Create **36 recognisable silhouettes** with cut-out details. Holes must be at least 2 cells wide at the grid width where the shape first appears.
  - Living (18): cat, fish, butterfly, bird, rabbit, turtle, elephant, owl, whale, snail, dog, horse, tree, flower, cactus, leaf, mushroom, octopus.
  - Non-living (18): house, car, rocket, cup, umbrella, key, star, anchor, bell, light bulb, airplane, sailboat, guitar, crown, clock, lighthouse, bicycle, castle.
- **Difficulty curve for 100 levels.** Level N uses seed `N*7919`. Every 10th level is a gold "Boss" level (+20% grid size).

  | Levels | Board | Arrow length | Hardness | Notes |
  |---|---|---|---|---|
  | 1–3 | hand-made 4×5 | 2–3 | – | Tutorial: 1) 3 straight free arrows; 2) one arrow blocks another; 3) a bent arrow chain |
  | 4–10 | rectangle 5×6 → 8×10 | 2–4 | 0 | |
  | 11–25 | shapes, width 10–14 | 3–6 | 0.2 | |
  | 26–50 | shapes, width 14–20 | 3–9 | 0.4 | |
  | 51–75 | width 18–26 | 4–12 | 0.6 | |
  | 76–95 | width 24–32 | 5–16 | 0.8 | |
  | 96–99 | width 30–34 | 5–18 | 1.0 | |
  | 100 | "The Knot", 30×40 rectangle | – | 1.0 | Best of 10 seeds by rounds |

  From level 11 on, 80% of levels are shapes, alternating between living and non-living, and each shape is used at least once.
- Generate levels on `Dispatchers.Default`, cache them in memory, and pre-generate the next level.
- **Unit tests:** all 100 levels generate, are solvable and deterministic, and generate in under 1.5 s each on the JVM. Average difficulty (rounds and start-free ratio) rises from band to band. The tap, block, win, lose, undo and star rules work. Shape masks are non-empty and holes exist.

## 3. Rendering and input (Compose Canvas)
- Draw arrows as paths with a stroke of 0.16×cell, round caps and joins, and a filled triangular head. Cache a `Path` for each arrow, and do not allocate memory inside `onDraw`.
- **Slide animation:** build an extended path (the arrow's path plus its ray, continuing 2 board-lengths off screen). Animate a distance `d` and draw the segment `[d, d+L]` using `PathMeasure.getSegment`. Duration is 220 ms plus 12 ms per cell, with FastOutSlowIn easing. Several arrows can animate at the same time.
- **Colours by state:**
  - Idle arrows: ink.
  - Tapped and escaping: blue.
  - Blocked: red flash.
  - Hint: a pulsing blue glow, with the ray drawn as dashed cells.
  - Cleared cells: faint dots.
- **Zoom and pan:** pinch to zoom (1× to 4×) and pan, clamped to the board. Double-tap to reset. The Zoom button toggles between fit and 2.2× zoom on the board's centre.
- **Tap detection:** convert the touch to a cell through the zoom/pan transform. Tapping any cell of an arrow selects it. If the tap lands on an empty cell, pick the nearest arrow cell within 0.6 cell. Ignore taps on arrows that are mid-animation.
- On win, the shape reveals itself: the silhouette fills in with a soft colour over 600 ms, then 120 confetti particles burst from it (a custom particle system, no libraries).
- The game must run at 60/120 fps on a 30×40 board. Avoid recomposing every frame: use `drawWithCache` plus `Animatable`s that are read only inside the draw phase.

## 4. Screens and UX (Material 3; follow the `docs/design/` mockups)
**Design tokens:**

| Token | Light | Dark |
|---|---|---|
| Ink | #16181D | #E9EBF0 |
| Accent | #2F6FED | #6B9BFF |
| Danger | #E5484D | – |
| Gold | #F5B62B | – |
| Success | #1F9D6B | – |
| Surface | #FFFFFF | #15171C |
| SurfaceAlt | #F3F4F7 | #1F232B |
| Muted text | #7A8090 | – |

Shape tokens: cards use 22 dp corners, buttons 18–20 dp, chips are pills. Use 8 dp spacing steps and generous white space. Support dark mode, dynamic colour off by default, edge-to-edge, and predictive back. Lock to portrait. On tablets, centre the content with a maximum width of 600 dp.

1. **Splash:** use the SplashScreen API with the app icon, then go to Home.
2. **Home:**
   - A two-tone logo: "Knot" in ink and "lo" in accent, with the tagline "Tap. Slide. Untangle."
   - A gradient Daily Challenge card (blue to violet) showing the date and streak.
   - A winding level-path map with nodes for done (with stars), current (large, glowing) and locked levels. It scrolls to the current level.
   - A large dark "▶ Play Level N" button.
   - A coin pill at the top.
   - Bottom navigation: Home, Levels, Collection, Settings.
3. **Levels:** a grid of all 100 levels showing stars, a lock, and a Boss badge. Group them into chapters of 10 with names (Sprout, Meadow, River, Forest, Canyon, Storm, Glacier, Volcano, Cosmos, The Knot).
4. **Game:**
   - Top bar: back button, "Level N" plus the shape name once it is revealed, and the coin pill.
   - Hearts row, then a thin progress bar showing the percentage of arrows cleared.
   - The board.
   - Bottom tools: Hint (with a count badge), Undo, Zoom, Restart, each a 58 dp rounded tile with an icon and a label.
   - Toasts: "Blocked! −1 heart" in a red pill.
   - Pause dialog: resume, restart, settings, home.
5. **Win bottom sheet:** animated stars, "Level N Cleared!", the shape name, a stats row (time, hearts, coins earned), "Next Level →" as the primary button, and "Replay for 3★" when stars are below 3. After the win screen of levels 5, 15 and 30, ask for an in-app review.
6. **Lose dialog:** "Out of hearts". Options: retry, or continue with +1 heart for 100 coins (only if the player can afford it).
7. **Daily Challenge:** a date-seeded shape level of medium-to-hard difficulty. It rewards 100 coins and tracks a streak.
8. **Collection:** a gallery of revealed silhouettes, split into Living and Non-living tabs. Unrevealed ones are shown as "?" cards. Show a progress count such as "12/36".
9. **Settings:**
   - Sound, haptics, theme (system/light/dark), arrow thickness (S/M/L), and a colour-blind high-contrast mode.
   - Show tutorial again, and reset progress (with confirmation).
   - Rate app, share app, privacy policy (in-app screen), and the version number.
10. **Tutorial (levels 1–3):** an animated hand pointer, coach-mark text ("Tap an arrow — it slides the way it points", "Blocked arrows cost a heart", "Clear them in the right order"), and dimming on everything except the target arrow.

**Economy:**
- Clearing a level earns +20 coins, plus +10 per star (first clear only; a replay that improves the stars pays the difference).
- A 7-day daily login reward pays 20, 30, 40, 50, 60, 80 and 150 coins.

## 5. Audio, haptics and polish
- Synthesise all sounds in code as 16-bit PCM WAV files written to `cacheDir` on first launch, then play them through `SoundPool`:
  - tap pop (880 Hz, 40 ms)
  - escape whoosh (noise sweep, 180 ms)
  - bump (110 Hz, 120 ms)
  - win arpeggio (C-E-G-C)
  - coin chime
- Haptics: a light tick on escape and a strong click on bump. Respect the settings.
- Add micro-interactions: buttons scale to 0.96 when pressed, screens cross-fade and slide, and the hearts pop when a heart is lost.
- Accessibility: content descriptions, 48 dp touch targets, TalkBack labels on the tools, and contrast of at least 4.5:1.

## 6. Data
- Use DataStore with JSON via kotlinx.serialization. Save:
  - per-level progress (stars, best time, cleared flag)
  - current level, coins, hints
  - daily streak, last login date and last daily-challenge date
  - revealed shapes
  - settings
- Autosave on every change. Survive process death: resume a level in progress, saving the remaining arrow ids, hearts and timer.

## 7. Release readiness
- Adaptive app icon as a vector: a white rounded snake-arrow knot on #2F6FED, with a monochrome layer for themed icons.
- `minSdk 24`. `targetSdk` and `compileSdk` should be the latest stable version installed (at least 35).
- `versionCode 1`, `versionName "1.0.0"`.
- Release build with R8 `minifyEnabled` and `shrinkResources`, with the needed keep rules for serialization.
- A `signingConfig` that reads `keystore.properties` (add it to `.gitignore`), plus a `docs/RELEASE.md` explaining how to create the keystore and run `./gradlew bundleRelease`.
- `docs/store/listing.md`:
  - Title: "Knotlo: Arrow Puzzle Escape"
  - An 80-character short description
  - A 4000-character full description using the keywords arrow puzzle, untangle, logic, brain teaser, offline, relaxing
  - Five screenshot captions
- `docs/store/privacy-policy.md` stating that no data is collected and the app works offline, with matching Data Safety answers.
- No internet permission, no ads and no analytics in v1. Keep a `RewardProvider` interface so ads can be added later.

## 8. Phases (commit after each one)
1. Engine and generator, shape DSL with 36 shapes, and the 100-level table, plus all unit tests passing.
2. Theme, design tokens, navigation and repositories (DataStore).
3. Board canvas: rendering, animations, input, zoom.
4. Game screen, win/lose screens, tutorial.
5. Home, Levels, Daily, Collection, Settings.
6. Audio, haptics and polish.
7. Icon, release config and store docs.
8. Final check:
   - Run `./gradlew lint testDebugUnitTest assembleRelease`.
   - Play levels 1, 2, 3, 10, 50 and 100 through the engine in a test.
   - Report any remaining issues honestly in `PROGRESS.md`.
