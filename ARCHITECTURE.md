# Architecture

> Describes how anigraph works internally. Updated as features are added.

## Overview

anigraph is a webapp for visualising information and statistics about anime.

Static HTML webapp. No build tooling, no framework, no bundler.

## Structure

```
index.html      shell — links stylesheet + script
css/style.css   global styles (reset + base)
js/main.js      entry point for all application logic
```

## Rendering model

Browser loads `index.html` directly. JS in `js/main.js` manipulates the DOM at runtime. No server-side rendering.
