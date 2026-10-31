# NASA APOD Museum

*Explore the Universe, One Day at a Time.*

NASA APOD Museum is a static website for browsing NASA's Astronomy Picture of the Day (APOD) archive and exploring real SPHEREx spectral image observations from the NASA/IPAC Infrared Science Archive (IRSA). It is built with plain HTML, CSS and JavaScript plus two small Vercel serverless functions, and was developed with the NASA Space Apps Challenge theme *Planet X and SPHEREx* in mind.

## Features

| Feature | Page | What it does |
|---|---|---|
| APOD Archive | `archive.html`, `detail.html` | Browse APOD entries from June 16, 1995 onward; open any entry for the NASA text, credits and a Wikipedia summary |
| Cosmic Collections | `collections.html` | Groups recent APOD entries into nine subjects using keyword matching |
| On This Day | `on-this-day.html` | Shows APOD entries published on the same calendar date in different years, plus Random Discovery |
| SPHEREx Explorer | `spherex.html` | Searches IRSA for SPHEREx observations and previews, with timeline, comparison and blink playback |

### APOD Archive
- The home page shows the latest APOD entry. The archive lists the latest entries 25 at a time ("Load more"), or one month at a time using the year and month selectors.
- Opening a specific date (June 16, 1995 to today) goes to its detail page.
- The detail page shows the media, title, date and NASA's original description, unmodified, with a link to the original NASA source. Entries that are not images link back to NASA.
- A "Learn more about this object" section shows a Wikipedia summary only when the entry matches a subject in the curated list in `data/categories.json`. Otherwise the section is not shown.
- Image credit text is extracted from the NASA response on a best-effort basis; the original NASA link is always provided.

### Cosmic Collections
Entries from the latest 100 APOD items are matched against keyword lists in `data/categories.json` to fill nine collections: Nebulae, Galaxies, Planets, Moons, Solar System, Sun, Black Holes, Star Clusters and Space Exploration. Each collection shows up to six entries. This is a browsing aid based on keyword matching, not a scientific classification, and an entry can appear in more than one collection.

### On This Day
Choose a month and day (it defaults to today's date). The site requests the APOD entry for that date in every year from 1995 to the current year and shows those that exist. **Random Discovery** picks a random date in the archive range and shows the entry found.

### SPHEREx Explorer
The explorer searches real SPHEREx spectral image observations through the IRSA Simple Image Access Version 2 (SIA2) service. Nothing on this page is simulated.

**Search.** Enter Right Ascension, Declination, a search radius (up to 0.5°) and optionally a date range, then choose a collection:

| Collection ID | Meaning |
|---|---|
| `spherex_qr3` | QR3 Wide Survey (default) |
| `spherex_qr3_deep` | QR3 Deep Survey |
| `spherex_qr2` | QR2 Wide Survey |
| `spherex_qr2_deep` | QR2 Deep Survey |

"Use WISE 0855 target" fills in the position derived from the catalog designation WISE J085510.83−071442.5 (RA 133.79513°, Dec −7.24514°).

**Views.** Results appear as an Observation Gallery, an Observation Timeline (sorted by time, with previous/next), a Time Comparison of two or more selected observations, and Blink Playback with play, pause, previous, next and speed controls. Previews are loaded on request, not automatically.

**How to read the results.**
- Each observation is a **separate exposure taken at a different time**. Blink Playback steps through these exposures in time order; it is not video and does not show continuous motion.
- Results depend on the selected collection, the sky coverage of that collection, the coordinates, the radius and the date range. A search can legitimately return nothing.
- A **valid empty result** is shown as a status message ("No SPHEREx observations were returned…"). A **connection error, IRSA error or timeout** is shown as a separate red error message. An empty result does not mean a collection is broken. IRSA's documentation also notes that newly released data can reach SIA2 later than other access routes.
- Known limitation: if IRSA returned a response with no data table at all, the current parser treats it as an empty result rather than an error.
- Catalog reference coordinates (such as the WISE 0855 position) come from a designation or catalog, not from SPHEREx measurements. Objects with large proper motion can be offset from their catalog position, so use a sufficiently large radius. The site makes no claim about object motion.
- Previews are cutouts (0.1°) of the IMAGE extension (MJy/sr) of the SPHEREx spectral image files, displayed in detector pixel orientation (not rotated to north-up) with a linear 1–99% scale shared across compared frames. Observations with different wavelength coverage are flagged because differences may reflect the band rather than the sky.

## Technology stack
- HTML5, CSS3 and vanilla JavaScript (ES modules). No frontend framework and no build step.
- Vercel serverless functions in Node.js (`api/apod.js`, `api/spherex.js`).
- Google Fonts: Fraunces and Source Sans 3.
- `vercel.json` configures Vercel Image Optimization for NASA image hosts and static cache headers.
- `package.json` declares no dependencies.

## Project structure
```
index.html  archive.html  detail.html  collections.html  on-this-day.html  spherex.html
css/style.css
js/
  app.js            shared navigation and helpers
  api.js            APOD + Wikipedia data layer and browser cache
  home.js  archive.js  detail.js  collections.js  on-this-day.js
  spherex.js        SPHEREx Explorer interface
  spherex-core.js   SIA2 search, VOTable parsing, FITS reading, IndexedDB cache
api/
  apod.js           proxy for the NASA APOD endpoint
  spherex.js        proxy for IRSA SIA2 and cutouts
data/categories.json  collection keywords and Wikipedia subject list
scripts/            hero-image helper scripts (see Hero image)
vercel.json  package.json  .env.example  .gitignore
```
The hero image files are expected in `assets/images/` (see below).

## API and data sources

**NASA APOD.** The browser calls `/api/apod`, which forwards allow-listed parameters (a single date as `YYMMDD`, `date_from`, `date_to`, `page`, `per_page` up to 25) to `https://science.nasa.gov/wp-json/wp/v2/apod-basic`. The proxy validates input and strips the bulky HTML field from list responses.

**Wikipedia.** Summaries come from `https://en.wikipedia.org/api/rest_v1/page/summary/` and supplement, never replace, NASA's text.

**IRSA SIA2.** `/api/spherex` forwards validated requests to `https://irsa.ipac.caltech.edu/SIA` (parameters `COLLECTION`, `POS=circle <ra> <dec> <radius>`, optional `TIME`) and to SPHEREx cutout URLs under `https://irsa.ipac.caltech.edu/ibe/data/spherex/` (parameters `center` and `size`). No SPHEREx API key is required. The browser stops reading each FITS cutout once the IMAGE extension has been read.

**Browser caching.**
- APOD and Wikipedia data use `localStorage`: the latest list page is kept for 6 hours, historical APOD data for 7 days and Wikipedia summaries for 7 days.
- SPHEREx search results and previews use IndexedDB with a **10-minute** lifetime (kept in memory if IndexedDB is unavailable). While the explorer is open and the tab is visible, it refreshes the current search when its cache expires; polling stops while the tab is hidden. Results may be up to 10 minutes old, and the page shows the last update time. Failed responses are not cached.
- Server responses also carry `Cache-Control` headers set in the API files.

## Setup and local development
Requirements: Node.js and the Vercel CLI.

```bash
npm i -g vercel
vercel dev
```
Open the local URL printed by the CLI (usually http://localhost:3000). The `/api` routes need `vercel dev`; opening the HTML files directly will not work. The SPHEREx cutouts and IRSA searches also require internet access.

## Environment variables
| Variable | Purpose |
|---|---|
| `NASA_API_KEY` | Listed in `.env.example` and reserved for server-side use. The current code does **not** read or send it; NASA's current APOD feed documentation lists no key requirement for this endpoint. |

Never place a key in HTML or frontend JavaScript. Keep local values in `.env.local` (git-ignored). No variable is used for SPHEREx.

## Hero image
`index.html` loads `assets/images/hero-640.webp`, `hero-1280.webp` and `hero-1920.webp` (640×320, 1280×640 and 1920×960) through `srcset`. These image files are not generated by this repository. The helper scripts in `scripts/` predate this setup: `optimize-hero.mjs` writes a single `hero-space.webp` (it needs `sharp`, which is not in `package.json`), and `get-hero.mjs` is currently empty. Record the photograph's creator and license when you add or replace the image.

## Deployment notes
The project is a static site with serverless functions and has no build step, which suits Vercel. `vercel.json` sets image-optimization options and cache headers. Confirm the allowed image hostnames in `vercel.json` match the image URLs NASA returns.

## Credits and acknowledgements
- NASA Astronomy Picture of the Day: https://apod.nasa.gov/apod/astropix.html
- NASA APIs: https://api.nasa.gov/
- SPHEREx data access: https://caltech-ipac.github.io/spherex-archive-documentation/spherex-data-access/
- SPHEREx data products: https://caltech-ipac.github.io/spherex-archive-documentation/spherex-data-products
- IRSA SIA2: https://irsa.ipac.caltech.edu/SIA
- SPHEREx cutout tool: https://irsa.ipac.caltech.edu/data/SPHEREx/docs/cutout_tool.html
- Wikipedia (text under CC BY-SA)

Astronomy media and observations keep their original creator and archive credits. APOD images may carry third-party copyright; see each entry's original NASA page. SPHEREx data are courtesy of NASA/IPAC-IRSA.
