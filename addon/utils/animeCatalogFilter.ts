import consola from 'consola';

const logger = consola.withTag('AnimeCatalogFilter');

const ANIME_ID_PREFIXES = ['mal:', 'anilist:', 'anidb:', 'kitsu:'];
const PERSONAL_CATALOG_MARKERS = [
  'watchlist',
  'favorites',
  'up_next',
  'upnext',
  'completed',
  'history',
  'resume',
];

interface AnimeCatalogFilterOptions {
  type: string;
  config: any;
  catalogConfig: any;
  cleanId: string;
  searchCatalogId?: string | null;
}

interface AnimeClassification {
  isAnime: boolean;
  reason?: string;
}

function normalizeId(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function parsePrefixedId(id: string | null, prefix: string): string | null {
  if (!id || !id.startsWith(prefix)) return null;
  const value = id.slice(prefix.length).trim();
  return value || null;
}

function getGenreNames(meta: any): Set<string> {
  const names = new Set<string>();
  if (!Array.isArray(meta?.genres)) return names;

  for (const genre of meta.genres) {
    if (typeof genre === 'string') {
      names.add(genre.trim().toLowerCase());
    } else if (genre?.name) {
      names.add(String(genre.name).trim().toLowerCase());
    }
  }

  return names;
}

function normalizeLanguage(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    const obj = value as any;
    value = obj.code ?? obj.id ?? obj.iso_639_1 ?? obj.iso_639_2 ?? obj.name ?? '';
  }
  return String(value).trim().toLowerCase().replace('_', '-');
}

function normalizeCountry(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    const obj = value as any;
    value = obj.code ?? obj.id ?? obj.iso_3166_1 ?? obj.shortCode ?? obj.name ?? '';
  }
  return String(value).trim().toLowerCase();
}

function looksLikeJapaneseAnimation(meta: any): boolean {
  const genres = getGenreNames(meta);
  if (genres.has('anime')) return true;
  if (!genres.has('animation')) return false;

  const rawLanguage = meta?.original_language ?? meta?.originalLanguage ?? meta?._originalLanguage ?? '';
  const language = normalizeLanguage(rawLanguage);
  const japaneseLanguage = language === 'ja'
    || language === 'jpn'
    || language === 'japanese'
    || language.startsWith('ja-')
    || language.startsWith('jpn-');

  const rawCountry = meta?.country ?? meta?.originalCountry ?? meta?._originCountry ?? meta?.origin_country;
  const countries = Array.isArray(rawCountry) ? rawCountry : [rawCountry];
  const normalizedCountries = countries
    .map(normalizeCountry)
    .filter(Boolean);

  const japaneseCountry = normalizedCountries.some((country: string) =>
    country === 'jp' || country === 'jpn' || country === 'japan'
  );

  return japaneseLanguage || japaneseCountry;
}

function isDedicatedAnimeCatalog(type: string, catalogConfig: any, cleanId: string): boolean {
  const typeCandidates = [type, catalogConfig?.type, catalogConfig?.displayType]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());

  if (typeCandidates.some((value) => value === 'anime' || value.startsWith('anime.'))) {
    return true;
  }

  if (catalogConfig?.genreSelection === 'anime') return true;

  const id = String(cleanId || '').toLowerCase();
  if (['mal.', 'anilist.', 'kitsu.', 'anidb.'].some((prefix) => id.startsWith(prefix))) return true;
  if (
    id === 'simkl.trending.anime'
    || id === 'simkl.calendar.anime'
    || id.startsWith('simkl.watchlist.anime.')
    || id.startsWith('simkl.discover.anime.')
    || id.includes('.anime.')
    || id.endsWith('.anime')
  ) return true;

  return false;
}

function isPersonalCatalog(cleanId: string): boolean {
  const id = String(cleanId || '').toLowerCase();
  return PERSONAL_CATALOG_MARKERS.some((marker) => id.includes(marker));
}

function classifyAnime(meta: any, fallbackType: string): AnimeClassification {
  if (!meta || typeof meta !== 'object') return { isAnime: false };

  const metaId = normalizeId(meta.id);
  const metaType = String(meta.type || fallbackType || '').toLowerCase();

  if (metaType === 'anime' || metaType.startsWith('anime.')) {
    return { isAnime: true, reason: 'anime media type' };
  }

  if (metaId && ANIME_ID_PREFIXES.some((prefix) => metaId.startsWith(prefix))) {
    return { isAnime: true, reason: 'anime ID prefix' };
  }

  const explicitAnimeIds = [
    meta._malId,
    meta.mal_id,
    meta.malId,
    meta._anilistId,
    meta.anilist_id,
    meta.anilistId,
    meta._anidbId,
    meta.anidb_id,
    meta.anidbId,
    meta._kitsuId,
    meta.kitsu_id,
    meta.kitsuId,
  ];

  if (explicitAnimeIds.some((value) => normalizeId(value))) {
    return { isAnime: true, reason: 'resolved anime database ID' };
  }

  const imdbId = normalizeId(meta.imdb_id ?? meta._imdbId)
    || (metaId && /^tt\d+$/.test(metaId) ? metaId : null)
    || parsePrefixedId(metaId, 'imdb:');
  const tmdbId = normalizeId(meta._tmdbId ?? meta.tmdb_id ?? meta.tmdbId)
    || parsePrefixedId(metaId, 'tmdb:');
  const tvdbId = normalizeId(meta._tvdbId ?? meta.tvdb_id ?? meta.tvdbId)
    || parsePrefixedId(metaId, 'tvdb:');

  const mappingType = metaType === 'movie' ? 'movie' : 'series';

  try {
    const idMapper = require('../lib/id-mapper');

    if (imdbId) {
      if (idMapper.getMappingByImdbId?.(imdbId)) {
        return { isAnime: true, reason: 'anime ID mapping (IMDb)' };
      }
      if (mappingType === 'movie' && idMapper.getTraktAnimeMovieByImdbId?.(imdbId)) {
        return { isAnime: true, reason: 'anime movie mapping (IMDb)' };
      }
    }

    if (tmdbId) {
      if (idMapper.getMappingByTmdbId?.(tmdbId, mappingType)) {
        return { isAnime: true, reason: 'anime ID mapping (TMDB)' };
      }
      if (mappingType === 'movie' && idMapper.getTraktAnimeMovieByTmdbId?.(tmdbId)) {
        return { isAnime: true, reason: 'anime movie mapping (TMDB)' };
      }
    }

    if (tvdbId && mappingType !== 'movie' && idMapper.getMappingByTvdbId?.(tvdbId)) {
      return { isAnime: true, reason: 'anime ID mapping (TVDB)' };
    }
  } catch (error: any) {
    logger.debug(`Primary anime mapping lookup unavailable: ${error?.message || error}`);
  }

  // Anime-Lists/AniDB mapping is an independent fallback and catches titles that
  // may not yet be present in the primary Fribb/Anime API mapping dataset.
  try {
    const animeListMapper = require('../lib/anime-list-mapper');

    if (imdbId && animeListMapper.getAnimeByImdbId?.(imdbId)?.length > 0) {
      return { isAnime: true, reason: 'Anime-Lists mapping (IMDb)' };
    }
    if (tmdbId && animeListMapper.getAnimeByTmdbId?.(tmdbId)?.length > 0) {
      return { isAnime: true, reason: 'Anime-Lists mapping (TMDB)' };
    }
    if (tvdbId && animeListMapper.getAnimeByTvdbId?.(tvdbId)?.length > 0) {
      return { isAnime: true, reason: 'Anime-Lists mapping (TVDB)' };
    }
  } catch (error: any) {
    logger.debug(`Anime-Lists mapping lookup unavailable: ${error?.message || error}`);
  }

  // Local title index is a positive-only fallback: exact known-anime title plus
  // Animation/Anime genre. Requiring the animation genre avoids removing unrelated
  // live-action titles that happen to share an anime title (for example, Overlord).
  try {
    const genres = getGenreNames(meta);
    if (genres.has('animation') || genres.has('anime')) {
      const localAnimeSearch = require('../lib/localAnimeSearch');
      const year = meta?.year ?? (typeof meta?.released === 'string' ? meta.released.slice(0, 4) : null);
      if (localAnimeSearch.isKnownAnimeTitle?.(String(meta?.name || ''), year)) {
        return { isAnime: true, reason: 'local anime title index' };
      }
    }
  } catch (error: any) {
    logger.debug(`Local anime title lookup unavailable: ${error?.message || error}`);
  }

  // Last-resort metadata heuristic. It deliberately requires Animation + Japanese
  // origin/language so Western cartoons and children's animation are preserved.
  if (looksLikeJapaneseAnimation(meta)) {
    return { isAnime: true, reason: 'Japanese animation metadata' };
  }

  return { isAnime: false };
}

function filterAnimeFromGeneralCatalogs(
  metas: any[],
  { type, config, catalogConfig, cleanId, searchCatalogId }: AnimeCatalogFilterOptions,
): any[] {
  if (!Array.isArray(metas) || metas.length === 0) return metas;

  // This custom build defaults the feature on. Saving the switch as false disables it.
  const catalogOverride = catalogConfig?.metadata?.excludeAnimeFromGeneralCatalogs;
  const enabled = catalogOverride !== undefined
    ? !!catalogOverride
    : config?.excludeAnimeFromGeneralCatalogs !== false;

  if (!enabled) return metas;

  // Search rows need special handling. General Movies/Shows search should hide anime,
  // while dedicated Anime Movies/Anime Series search must remain untouched.
  if (cleanId === 'search') {
    const slot = String(searchCatalogId || '').toLowerCase();
    if (slot === 'anime_movie' || slot === 'anime_series') return metas;
    if (slot !== 'movie' && slot !== 'series') return metas;
  }

  if (isDedicatedAnimeCatalog(type, catalogConfig, cleanId)) return metas;
  if (['people_search', 'gemini.search'].includes(cleanId)) return metas;
  if (isPersonalCatalog(cleanId)) return metas;

  const removed: Array<{ name: string; reason: string }> = [];
  const filtered = metas.filter((meta) => {
    const classification = classifyAnime(meta, type);
    if (!classification.isAnime) return true;

    removed.push({
      name: String(meta?.name || meta?.id || 'unknown'),
      reason: classification.reason || 'anime detected',
    });
    return false;
  });

  if (removed.length > 0) {
    logger.info(
      `Filtered ${removed.length} anime title${removed.length === 1 ? '' : 's'} from general catalog ${cleanId}`,
    );
    for (const item of removed) {
      logger.debug(`Removed "${item.name}" (${item.reason})`);
    }
  }

  return filtered;
}

export {
  classifyAnime,
  filterAnimeFromGeneralCatalogs,
  isDedicatedAnimeCatalog,
};
