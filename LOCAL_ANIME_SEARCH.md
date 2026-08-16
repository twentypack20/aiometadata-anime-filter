# Local Anime Search (v4)

This custom build adds **Local Anime Index** as a search provider for the dedicated Anime Series and Anime Movies search rows.

## What it changes

When selected, a title query is resolved against a local in-memory index instead of sending the text query to MAL/Jikan or Kitsu.

The default title dataset is the lightweight `anime-index.json` published by `subhajeetch-fl/anime-mapper`. The index is downloaded to `addon/data/local-anime-index.json.cache`, loaded into memory, and refreshed every 24 hours by default.

Each local record is keyed by MyAnimeList ID. AIOMetadata then uses its existing ID mapper to resolve that MAL ID to a Kitsu ID. Search results are returned as `kitsu:<id>`, so the user's existing Kitsu metadata provider and Kitsu stream-compatibility path continue to work when the title is opened.

**Important:** the search results themselves are built from the local index. A normal successful local search does not call Kitsu's text-search endpoint. Kitsu can optionally be used as a fallback only when the local index returns zero usable results or cannot load.

## Search ranking

The local search normalizes Unicode, punctuation, dashes, spacing, and case, then ranks matches roughly as:

1. Exact title match
2. Exact compact match (for example `dragonball` vs `Dragon Ball`)
3. Title prefix
4. Phrase/substring match
5. All query tokens present

English/canonical, Romaji, and native/Japanese titles are indexed.

Movies are limited to records whose anime type is `MOVIE`. Anime-series search accepts `TV`, `ONA`, `OVA`, `SPECIAL`, `TV SPECIAL`, and `WEB`, matching the intent of the existing Kitsu anime search more closely than treating every animation record as a series.

## Configuration

Choose these in **Configure → Search**:

- Anime Series Search → `Local Anime Index (Series)`
- Anime Movies Search → `Local Anime Index (Movies)`

Optional server settings:

```env
LOCAL_ANIME_SEARCH_UPDATE_INTERVAL_HOURS=24
LOCAL_ANIME_SEARCH_URL=https://cdn.jsdelivr.net/gh/subhajeetch-fl/anime-mapper@main/data/anime-index.json
LOCAL_ANIME_SEARCH_KITSU_FALLBACK=true
```

With fallback enabled, Kitsu text search is used only when local search produces zero usable Kitsu-mapped results. Set it to `false` if you want anime title search to have no live Kitsu-search fallback at all.

## Source and licensing notes

The default `anime-mapper` repository is MIT-licensed, but its generated metadata is compiled from public upstream APIs including Jikan/MAL, Kitsu, AniList, AnimeAPI and Zenshin. The repository itself explicitly says consumers should respect each upstream service's terms. For a commercial deployment, review those upstream terms rather than treating the repository's MIT code license as a blanket re-license of all underlying metadata.

Other actively maintained sources researched for this feature include:

- **bangumi-data** — actively maintained Japanese anime dataset; data is CC BY 4.0 and includes original titles, translated titles, media type and broadcast dates. This is a strong candidate for a future licensing-clean title/alias supplement.
- **nattadasu/animeApi** — actively updated cross-provider relation database with a title plus 22+ provider IDs. Its database is ODbL 1.0 + DbCL 1.0, so attribution/share-alike database obligations must be respected.
- **Fribb/anime-lists** — actively maintained and already used by AIOMetadata for cross-provider mapping. It is mapping-oriented rather than a complete searchable title database.
- **Kometa-Team/Anime-IDs** — generated daily and useful for ID conversions, but likewise mapping-oriented rather than a title-search dataset.

The archived `manami-project/anime-offline-database` is intentionally not used as the v4 live title-index source.
