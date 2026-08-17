# AIOMetadata v5 — Kitsu Episode Number Bridge

This custom patch keeps Kitsu as the anime identity while exposing reliable conventional season/episode numbers when AIOMetadata already has a non-fallback TMDB episode mapping.

## Why

Kitsu anime series commonly expose episodes as one season with anime-style/absolute numbering. Torrent releases may instead use conventional `SxxEyy` numbering. AIOStreams' season/episode matcher should be able to validate either representation without disabling anime episode matching.

## Episode ID formats

Legacy Kitsu episode IDs remain supported:

```text
kitsu:<kitsuId>:<absoluteEpisode>
```

When a trustworthy TMDB episode mapping is available, AIOMetadata now emits:

```text
kitsu:<kitsuId>:<absoluteEpisode>:<mappedSeason>:<mappedEpisode>
```

Example:

```text
kitsu:12345:107:4:8
```

means:

- Kitsu/anime episode: 107
- conventional mapped episode: S04E08

The Stremio video object's `season` and `episode` fields use the mapped S/E pair, while `absoluteEpisode` preserves the Kitsu episode number.

## Safety

The bridge is only emitted when the existing `resolveTmdbEpisodesFromKitsu()` result is present and is **not** marked `isFranchiseFallback`. If the mapping is absent or uncertain, AIOMetadata keeps the legacy Kitsu ID and Season 1 / anime episode numbering.

## Required AIOStreams companion patch

The extended ID format is intentionally consumed by the paired custom AIOStreams patch. AIOStreams strips the appended S/E bridge before querying third-party addons, so Torrentio/Zilean/etc. continue receiving the legacy Kitsu ID they already understand.
