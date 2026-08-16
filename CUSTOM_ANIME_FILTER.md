# Custom General-Catalog Anime Filter

This fork adds an optional catalog filter that hides anime from ordinary movie and series discovery rows while leaving dedicated anime catalogs intact.

## Behavior

The setting is enabled by default in this custom build and is available at:

**Configure → Content Filters → Anime in General Catalogs**

When enabled:

- General discovery catalogs such as trending, top-rated, provider/service catalogs, and similar movie/series rows can have anime removed.
- Dedicated anime catalogs (MAL, AniList, Kitsu/AniDB-style catalogs, and SIMKL anime catalogs) are left unchanged.
- Ordinary Movies/Shows search rows also remove anime.
- Dedicated Anime Movies/Anime Series search rows are left unchanged so anime can still be found intentionally.
- Personal rows such as watchlists, favorites, Up Next, completed/history, and resume are left unchanged.
- Western cartoons and children's animation are retained unless the title actually maps to an anime database.

## Detection order

The filter does **not** inspect torrent names, audio languages, or debrid results. Classification is metadata-driven and uses AIOMetadata's existing mapping data:

1. A title already has an anime media type or anime-provider ID.
2. AIOMetadata has resolved a MAL, AniList, AniDB, or Kitsu ID for it.
3. Existing IMDb/TMDB/TVDB → anime mappings identify it as anime.
4. Trakt anime-movie mappings identify it as anime.
5. Anime-Lists/AniDB mappings identify it as anime.
6. Conservative fallback: the item is Animation and has Japanese original language/origin metadata.

The fallback deliberately requires animation plus Japanese origin/language so ordinary US/Western animation is not removed merely for having the `Animation` genre.

## Per-catalog override

The global option is:

```json
{
  "excludeAnimeFromGeneralCatalogs": true
}
```

A catalog can optionally override the global behavior in its metadata:

```json
{
  "metadata": {
    "excludeAnimeFromGeneralCatalogs": false
  }
}
```

## Docker image

The included `Build Custom AIOMetadata Image` GitHub Actions workflow builds on pushes to `main`, `master`, or `dev` and publishes:

- `ghcr.io/<owner>/<repo>:anime-filter`
- `ghcr.io/<owner>/<repo>:latest`

The workflow currently targets `linux/amd64` for a typical VPS deployment.

## v3: origin-aware normal search filtering

v3 keeps the v2 search-row behavior and improves the conservative fallback used when an anime title has no usable cross-ID mapping.

- TMDB normal Movie/Series search now preserves `original_language` and origin-country hints on internal search metas before filters run.
- TVDB normal search now preserves `originalLanguage` and `originalCountry` from extended records.
- The Japanese-animation fallback recognizes `ja`, `jpn`, `japanese`, locale variants such as `ja-JP`, and Japan country identifiers.
- The rule still requires the result to be Animation (or explicitly Anime), so Western animation remains in normal rows.
- Dedicated Anime Movies / Anime Shows search rows remain untouched.
- This patch intentionally does not try to remove fan-made or low-quality TVDB records unless they independently classify as anime; search-quality cleanup is a separate concern.

