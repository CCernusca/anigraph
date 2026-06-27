# anigraph

A little webapp for visualising information and statistics about anime.

## Usage

Open `index.html` in a browser — no build step required.

Import a `.txt` file with one anime title per line. The app sends a single batched query to the AniList API and displays genres and tags for each title found. Titles with no match are shown as "Not found".

## Project structure

```
index.html      entry point
css/style.css   global styles
js/main.js      application logic
```
