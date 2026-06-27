# anigraph

A little webapp for visualising information and statistics about anime.

## Usage

Open `index.html` in a browser — no build step required.

1. Use the **right sidebar** to import a `.txt` file (one anime title per line) and click **Search**.
2. Matching anime appear as **circles** in the center, styled with each title's dominant cover colour.
3. **Hover** over a circle to see a popup with the title, genres, and community-rated tags.
4. Click **↗** in the popup to open the anime's AniList page.

Unmatched titles are silently omitted. Feedback (errors, rate limits) appears below the search button.

## Project structure

```
index.html      entry point
css/style.css   global styles
js/main.js      application logic
```
