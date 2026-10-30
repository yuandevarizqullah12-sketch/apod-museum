# NASA APOD MUSEUM
*Explore the Universe, One Day at a Time.*

Vanilla HTML/CSS/JS site plus one Vercel serverless function (`api/apod.js`). Data: NASA APOD (WordPress endpoint `science.nasa.gov/wp-json/wp/v2/apod-basic`) and the Wikipedia REST summary API.

## Setup
1. **NASA key (optional):** NASA's current APOD feed guide lists no key requirement for this endpoint. If you still want one, register at https://api.nasa.gov/ and keep it server-side only.
2. **Vercel:** Project → Settings → Environment Variables → add `NASA_API_KEY` (the proxy does not send it today; see comment in `api/apod.js`).
3. **Local test:** `npm i -g vercel`, copy `.env.example` to `.env.local`, run `vercel dev`, open http://localhost:3000.
4. **Deploy:** push to GitHub, import in Vercel, deploy (no build step).

## Known limitations
- **Hero image:** no Wikimedia Commons file was license-verified, so the hero uses a CSS-generated background. To add one, verify the Commons file page (license, creator, URL), save it as `assets/images/hero-space.jpg`, and record the credit here.
- Image and credit fields come from `hdurl` and the `basic_html` text; thumbnails are full-size images (lazy-loaded). Image credit extraction is best-effort, so the original NASA link is always shown. Video entries link back to NASA.
- Collections classify only the latest ~100 entries by keyword.
- The NASA list endpoint takes legacy YYMMDD dates, so month browsing is per-year. On This Day makes one request per year (cached).
- Wikipedia matching uses a curated subject list in `data/categories.json`; unmatched entries show no Wikipedia section.
- `fallback.jpg` is replaced by an inline SVG fallback.

## Hero photo
`node scripts/get-hero.mjs` downloads `assets/images/hero-space.jpg` (Center of the Milky Way Galaxy IV – Composite; NASA/JPL-Caltech/ESA/CXC/STScI; public domain per its Commons page; confirm the license on the file page before publishing). The homepage shows a visible warning if the file is absent.
