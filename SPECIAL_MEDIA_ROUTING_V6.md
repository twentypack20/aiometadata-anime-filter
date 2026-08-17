# Custom v6: Mapping-aware anime special routing

This custom update builds on v5's local anime search, general-catalog anime filtering, and Kitsu episode-number bridge.

## Problem addressed

Anime providers can describe a standalone production as `Special` / `TV Special` even when downstream IMDb/TMDB/Trakt/Stremio metadata treats that title as a movie. If such a title is forced through a series route, metadata may be missing and a Kitsu ID can be misinterpreted by the UI as a season-like number.

A concrete regression seen during testing was `Dragon Ball Z: The History of Trunks` (`kitsu:875`) appearing in Anime Shows and then failing series metadata resolution.

## What v6 changes

### 1. Mapping-aware movie/series classification

`id-mapper.js` now resolves an anime title's Stremio container using strong local mapping signals in this order:

1. Trakt anime-movie compatibility mapping
2. animeApi's TMDB/Trakt container type
3. obvious anime source format (`Movie`, `TV`, `OVA`, `Web`)
4. existing ONA resolver
5. Fribb mapping fallback

`Special` / `TV Special` remains conservative: it only becomes a movie when the mapping data positively identifies it as movie-like.

### 2. Preserve animeApi container type

The animeApi overlay now keeps its movie-vs-TV type separately as `_animeApiType`, even when Fribb already supplies an anime-format type such as `Special`. This avoids losing useful media-container information during mapping merges.

### 3. Local search uses the resolved media type

The local title index no longer hardcodes all Specials into Anime Shows. Search results are mapped first and then routed into Anime Movies or Anime Shows according to the resolver.

### 4. Kitsu fallback uses the same classification

Kitsu fallback search now includes specials in both raw search pools and filters each result through the same mapping-aware resolver. This prevents fallback search from undoing local-search classification.

### 5. Empty later pages no longer trigger Kitsu fallback

If local search has matching results but a later page is empty, AIOMetadata now returns an empty page instead of switching to Kitsu. This prevents two search sources from being mixed during pagination.

### 6. Metadata path honors resolved special type

Anime metadata requests are reclassified before building the response. The Kitsu builder can now be explicitly told to construct movie metadata for a movie-like special rather than treating every non-`movie` Kitsu subtype as a series.

### 7. Kitsu movie playback respects Anime Stream Compatibility ID

For movie-like Kitsu anime, `behaviorHints.defaultVideoId` now follows the configured anime stream compatibility ID. With `IMDb ID` selected, standalone anime movies/specials use the mapped IMDb ID for stream discovery while keeping Kitsu metadata/art.

## Expected History of Trunks behavior

With the user's current configuration:

- Anime provider: Kitsu
- Anime search: Local Anime Index
- Anime stream compatibility ID: IMDb

`Dragon Ball Z: The History of Trunks` should be routed as a movie-like anime item when the loaded mapping datasets identify it as such. It should no longer create a bogus series season such as `Season 875`.
