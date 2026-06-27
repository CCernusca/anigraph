# anigraph

A little webapp for visualising information and statistics about anime.

<img width="1367" height="797" alt="image" src="https://github.com/user-attachments/assets/d0e09941-e723-4091-9e0d-c8a68ea85ed1" />

## Usage

Open `index.html` in a browser — no build step required.

1. Use the **right sidebar** to import a `.txt` file (one anime title per line) and click **Search**.
2. Matching anime appear as **circles** in a live physics simulation — nodes repel each other, shared-selection connections act as springs.
3. **Drag** the background to pan. **Scroll** to zoom.
4. **Hover** a circle to see a popup with genres and community-rated tags; its connection lines highlight.
5. **Hover** a connection line to see shared selection items; its two endpoint circles highlight.
6. Click **↗** in the popup to open the anime's AniList page.

Anime sharing selection items are connected by lines. Spring stiffness and line opacity scale with connection strength (relative to the strongest connection). Configure the **Selection** mode in the sidebar:

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
