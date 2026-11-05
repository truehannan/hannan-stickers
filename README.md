# Pixelated Stickers

A black-and-grey pixel gallery that lists images from a private R2 bucket folder.
One Cloudflare Worker with static assets: the page lives in `public/`, the Worker in `src/index.js`.

## Why a Worker and not Pages

Pages can only read an R2 binding through Pages Functions, which are Workers underneath.
A Worker with static assets gives you the same single deploy, and it is Cloudflare's current recommended setup.
The Worker runs only for `/api/*` and `/img/*`. Everything else is served straight from `public/`.

## Setup

1. `npm install`
2. Open `wrangler.jsonc` and set:
   - `bucket_name`: your R2 bucket
   - `STICKER_PREFIX`: the folder inside the bucket (default `stickers/`)
3. Put your photo at `public/profile.png`. Until then the page shows `public/profile.svg`.
4. Upload stickers to that folder, for example:
   `npx wrangler r2 object put my-bucket/stickers/cat.png --file ./cat.png --remote`
5. `npm run deploy`

Local preview: `npm run dev`. It uses a local, empty R2 copy. Seed it with the same
command using `--local`, or add `"remote": true` to the binding to read your real bucket.

## What it does

- Grid of every image in the folder, sorted naturally (`s2.png` before `s10.png`)
- Click a sticker to select it. Select all and Clear are in the top bar
- Install on each card saves that one file
- Install selected (N) and Download all (.zip) pack files in the browser, so the Worker does no heavy work
- Allowed types: png, gif, webp, jpg, jpeg, avif

## Security

- The bucket stays private. The only way in is the binding, through two read-only routes
- GET and HEAD only. Everything else returns 405
- Names are checked: no slashes, no `..`, images only, and only inside `STICKER_PREFIX`
- Content type comes from the file extension, never from stored metadata
- SVG is blocked on purpose, since an SVG opened directly can run scripts
- Strict CSP and security headers on the page (`public/_headers`) and on image responses
- File names are inserted with `textContent`, never as HTML

## Notes

- Fonts are Press Start 2P and VT323 from Google Fonts. To self-host them, download the files,
  put them in `public/`, and replace the `<link>` in `index.html` with `@font-face` rules
  (then drop the two Google domains from the CSP).
- The sticker list is cached for 60 seconds and images for an hour. Change the numbers in `src/index.js` if you want faster updates.
