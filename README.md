# vrc-banners

Online banners for VRChat worlds. Players load them when they join.

- `banners/`: the source images, one per slot. Any size works; each is centre-cropped to 1200×300.
- `slots.json`: lists which slots are on, plus each one's seconds on screen and name.
- `build.py`: packs the "on" banners into `atlas_N.jpg` sheets (6 per sheet, max 2048 px) and writes `manifest.json`.
- `.github/workflows/build.yml`: runs `build.py` on every push and publishes the result to GitHub Pages.
- `google-form/BannerUpload.gs`: the upload form's script. The setup steps are at the top of that file.

Live: https://maxii-vr.github.io/vrc-banners/ (a preview page that shows every sheet)

The world has these URLs baked in, so their names must never change:
`manifest.json`, `atlas_0.jpg` … `atlas_3.jpg`. That allows at most 24 banners on at once.
GitHub Pages caches for about 10 minutes, so players who join after that see a change.

Everything in this repo is public. Only add images meant to be seen.
