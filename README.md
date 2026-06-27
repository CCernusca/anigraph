# anigraph

A little webapp for visualising information and statistics about anime.

## Usage

Open `index.html` in a browser — no build step required.

1. Use the **right sidebar** to import a `.txt` file (one anime title per line) and click **Search**.
2. Matching anime appear as **circles** in the center, styled with each title's dominant cover colour.
3. **Hover** over a circle to see a popup with genres and community-rated tags. Connected lines highlight.
4. **Hover** over a connection line to see shared selection items; the two connected circles highlight.
5. Click **↗** in the popup to open the anime's AniList page.

Anime sharing selection items are connected by lines. Configure the **Selection** mode in the sidebar:

| Mode | Behaviour |
|------|-----------|
| % cutoff | Tags above a minimum acceptance % |
| Top N | Top N tags by acceptance (slider max = tag count in data) |
| Top % | Top fraction of tags by acceptance |
| Genres | All genres (connections and highlights based on genres) |

Unmatched titles are silently omitted. Feedback (errors, rate limits) appears below the search button.

## Project structure

```
index.html      entry point
css/style.css   global styles
js/main.js      application logic
```
