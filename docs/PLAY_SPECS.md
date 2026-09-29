# Google Play asset specifications

Every number StoreShot exports at lives in `src/core/playstore.ts`. This file
records where those numbers came from and when they were last checked, because
Google revises the Play Console help pages without notice and a stale constant
here means a rejected upload for every user.

**Last verified: not yet verified against a live Play Console page.**

The values below were written from documentation knowledge during the initial
build. The Play Console help pages could not be fetched from the build
environment (`support.google.com` and `play.google.com` are blocked by its
network policy), so they are unconfirmed.

**Before any public release, open Play Console → your app → Grow → Store
presence → Main store listing, confirm each row, and update both this table and
`src/core/playstore.ts`.**

| Asset | Dimensions used | Count | Format | Confirmed |
| --- | --- | --- | --- | --- |
| Phone screenshot, portrait | 1080 × 1920 | 2–8 | 24-bit PNG or JPEG, no alpha | ☐ |
| Phone screenshot, landscape | 1920 × 1080 | 2–8 | 24-bit PNG or JPEG, no alpha | ☐ |
| 7-inch tablet screenshot | 1200 × 1920 | up to 8 | 24-bit PNG or JPEG, no alpha | ☐ |
| 10-inch tablet screenshot | 1600 × 2560 | up to 8 | 24-bit PNG or JPEG, no alpha | ☐ |
| Feature graphic | 1024 × 500 | 1 | 24-bit PNG or JPEG, no alpha | ☐ |

Other constraints encoded in `validateProject`:

- Screenshots: each side between 320 px and 3840 px.
- Screenshots: aspect ratio between 1:2 and 2:1.
- The feature graphic is exempt from both rules above. At 1024 × 500 it is
  2.048:1, which is outside the screenshot range by design. Applying the
  screenshot rules to it rejects a valid asset — this was a real bug, caught by
  `tests/unit/project.test.ts`.

## The alpha channel

Play asks for 24-bit PNG, meaning no alpha channel. A browser canvas is always
RGBA, so `canvas.toBlob('image/png')` always writes colour type 6. StoreShot
therefore encodes PNGs itself in `src/core/png.ts` as colour type 2, and
`tests/e2e/editor.spec.ts` asserts byte 25 of every exported file is `2`.

An image editor that re-saves an exported file may put the alpha channel back.
The README in each export ZIP warns about this.
