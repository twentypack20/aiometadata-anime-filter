import fs from 'node:fs/promises';
import path from 'node:path';
import axios from 'axios';
import consola from 'consola';

const idMapper: any = require('./id-mapper');
const { getSetting }: any = require('./settingsService');

const logger = consola.withTag('Local-Anime-Search');

const DEFAULT_INDEX_URL = 'https://cdn.jsdelivr.net/gh/subhajeetch-fl/anime-mapper@main/data/anime-index.json';
const RAW_FALLBACK_URL = 'https://raw.githubusercontent.com/subhajeetch-fl/anime-mapper/main/data/anime-index.json';
const LOCAL_CACHE_PATH = path.join(process.cwd(), 'addon', 'data', 'local-anime-index.json.cache');
const DEFAULT_UPDATE_INTERVAL_HOURS = 24;
const PAGE_SIZE = 20;

interface UpstreamAnimeIndexEntry {
  id: number | string;
  title?: string;
  romajiTitle?: string;
  nativeTitle?: string;
  year?: number | null;
  season?: string | null;
  type?: string | null;
  status?: string | null;
  episodeCount?: number | null;
  image?: string | null;
  score?: number | null;
  updatedAt?: string | null;
}

interface LocalAnimeRecord {
  malId: number;
  title: string;
  romajiTitle: string;
  nativeTitle: string;
  year: number | null;
  season: string | null;
  animeType: string;
  status: string | null;
  episodeCount: number | null;
  image: string | null;
  score: number | null;
  normalizedTitles: string[];
  normalizedCombined: string;
}

export interface LocalAnimeSearchResult {
  malId: number;
  kitsuId: number;
  title: string;
  romajiTitle: string;
  nativeTitle: string;
  year: number | null;
  season: string | null;
  animeType: string;
  status: string | null;
  episodeCount: number | null;
  image: string | null;
  score: number | null;
}

let records: LocalAnimeRecord[] = [];
let exactTitleIndex = new Map<string, LocalAnimeRecord[]>();
const searchCache = new Map<string, { expiresAt: number; results: LocalAnimeSearchResult[] }>();
const SEARCH_CACHE_TTL_MS = 10 * 60 * 1000;
const SEARCH_CACHE_MAX = 500;
let initialized = false;
let initializePromise: Promise<void> | null = null;
let refreshTimer: ReturnType<typeof setInterval> | null = null;
let lastLoadedAt: Date | null = null;
let lastSource = 'none';

function settingString(key: string, fallback: string): string {
  const value = getSetting?.(key);
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function updateIntervalHours(): number {
  const raw = Number(getSetting?.('LOCAL_ANIME_SEARCH_UPDATE_INTERVAL_HOURS'));
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_UPDATE_INTERVAL_HOURS;
}

export function isLocalAnimeKitsuFallbackEnabled(): boolean {
  const value = getSetting?.('LOCAL_ANIME_SEARCH_KITSU_FALLBACK');
  if (value === false || String(value).toLowerCase() === 'false' || String(value) === '0') return false;
  return true;
}

function normalizeSearchText(value: string): string {
  if (!value) return '';
  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s*&\s*/g, ' and ')
    .replace(/[\u2010-\u2015\u2212_\/-]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactSearchText(value: string): string {
  return normalizeSearchText(value).replace(/\s+/g, '');
}

function normalizeAnimeType(value: unknown): string {
  return String(value || '').trim().toUpperCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

function isTypeAllowed(record: LocalAnimeRecord, type: 'movie' | 'series'): boolean {
  if (type === 'movie') return record.animeType === 'MOVIE';
  return new Set(['TV', 'ONA', 'OVA', 'SPECIAL', 'TV SPECIAL', 'WEB']).has(record.animeType);
}

function makeRecord(item: UpstreamAnimeIndexEntry): LocalAnimeRecord | null {
  const malId = Number(item?.id);
  if (!Number.isFinite(malId) || malId <= 0) return null;

  const title = typeof item.title === 'string' ? item.title.trim() : '';
  const romajiTitle = typeof item.romajiTitle === 'string' ? item.romajiTitle.trim() : '';
  const nativeTitle = typeof item.nativeTitle === 'string' ? item.nativeTitle.trim() : '';
  if (!title && !romajiTitle && !nativeTitle) return null;

  const normalizedTitles = [...new Set([title, romajiTitle, nativeTitle].map(normalizeSearchText).filter(Boolean))];
  if (!normalizedTitles.length) return null;

  return {
    malId,
    title: title || romajiTitle || nativeTitle,
    romajiTitle,
    nativeTitle,
    year: Number.isFinite(Number(item.year)) ? Number(item.year) : null,
    season: typeof item.season === 'string' ? item.season : null,
    animeType: normalizeAnimeType(item.type),
    status: typeof item.status === 'string' ? item.status : null,
    episodeCount: Number.isFinite(Number(item.episodeCount)) ? Number(item.episodeCount) : null,
    image: typeof item.image === 'string' && item.image.trim() ? item.image.trim() : null,
    score: Number.isFinite(Number(item.score)) ? Number(item.score) : null,
    normalizedTitles,
    normalizedCombined: normalizedTitles.join(' | '),
  };
}

function processIndex(payload: unknown): void {
  if (!Array.isArray(payload)) throw new Error('Local anime index payload was not an array');

  const next: LocalAnimeRecord[] = [];
  const seen = new Set<number>();
  for (const item of payload as UpstreamAnimeIndexEntry[]) {
    const record = makeRecord(item);
    if (!record || seen.has(record.malId)) continue;
    seen.add(record.malId);
    next.push(record);
  }

  if (next.length < 1000) {
    throw new Error(`Local anime index parsed only ${next.length} records; refusing suspicious payload`);
  }

  records = next;
  exactTitleIndex = new Map();
  for (const record of records) {
    for (const normalizedTitle of record.normalizedTitles) {
      const bucket = exactTitleIndex.get(normalizedTitle) || [];
      bucket.push(record);
      exactTitleIndex.set(normalizedTitle, bucket);
    }
  }
  searchCache.clear();
  initialized = true;
  lastLoadedAt = new Date();
}

async function readCache(): Promise<{ payload: unknown; ageMs: number }> {
  const [text, stat] = await Promise.all([
    fs.readFile(LOCAL_CACHE_PATH, 'utf8'),
    fs.stat(LOCAL_CACHE_PATH),
  ]);
  return { payload: JSON.parse(text), ageMs: Math.max(0, Date.now() - stat.mtimeMs) };
}

async function downloadIndex(): Promise<unknown> {
  const configuredUrl = settingString('LOCAL_ANIME_SEARCH_URL', DEFAULT_INDEX_URL);
  const urls = [...new Set([configuredUrl, configuredUrl === DEFAULT_INDEX_URL ? RAW_FALLBACK_URL : ''].filter(Boolean))];
  let lastError: any = null;

  for (const url of urls) {
    try {
      logger.info(`Downloading anime title index from ${url}`);
      const response = await axios.get(url, {
        timeout: 60_000,
        maxRedirects: 5,
        responseType: 'json',
        validateStatus: (status) => status >= 200 && status < 300,
      });
      if (!Array.isArray(response.data)) throw new Error('downloaded payload was not an array');

      await fs.mkdir(path.dirname(LOCAL_CACHE_PATH), { recursive: true });
      await fs.writeFile(LOCAL_CACHE_PATH, JSON.stringify(response.data), 'utf8');
      lastSource = url.includes('jsdelivr.net') ? 'anime-mapper/jsDelivr' : 'anime-mapper/GitHub';
      return response.data;
    } catch (error: any) {
      lastError = error;
      logger.warn(`Anime index download failed from ${url}: ${error?.message || error}`);
    }
  }

  throw lastError || new Error('Anime index download failed');
}

async function refreshIndex(forceNetwork = false): Promise<void> {
  const maxAgeMs = updateIntervalHours() * 60 * 60 * 1000;

  if (!forceNetwork) {
    try {
      const cached = await readCache();
      if (cached.ageMs < maxAgeMs) {
        processIndex(cached.payload);
        lastSource = 'disk cache';
        logger.info(`Loaded ${records.length.toLocaleString()} local anime titles from disk cache`);
        return;
      }
    } catch {
      // No usable cache yet; download below.
    }
  }

  try {
    const payload = await downloadIndex();
    processIndex(payload);
    logger.success(`Loaded ${records.length.toLocaleString()} local anime titles`);
    return;
  } catch (error: any) {
    logger.warn(`Could not refresh local anime index: ${error?.message || error}`);
  }

  try {
    const cached = await readCache();
    processIndex(cached.payload);
    lastSource = 'stale disk cache';
    logger.warn(`Using stale local anime index cache (${records.length.toLocaleString()} titles)`);
  } catch (fallbackError: any) {
    throw new Error(`Local anime index unavailable and no disk cache exists: ${fallbackError?.message || fallbackError}`);
  }
}

function ensureRefreshTimer(): void {
  if (refreshTimer) return;
  const intervalMs = updateIntervalHours() * 60 * 60 * 1000;
  refreshTimer = setInterval(() => {
    refreshIndex(true).catch((error: any) => logger.warn(`Scheduled anime index refresh failed: ${error?.message || error}`));
  }, intervalMs);
  refreshTimer.unref?.();
}

export async function initializeLocalAnimeSearch(): Promise<void> {
  if (initialized) {
    ensureRefreshTimer();
    return;
  }
  if (!initializePromise) {
    initializePromise = refreshIndex(false)
      .then(() => ensureRefreshTimer())
      .finally(() => { initializePromise = null; });
  }
  await initializePromise;
}

function rankRecord(record: LocalAnimeRecord, normalizedQuery: string): number {
  if (!normalizedQuery) return 0;
  const compactQuery = normalizedQuery.replace(/\s+/g, '');
  const queryTokens = normalizedQuery.split(' ').filter(Boolean);
  let best = 0;

  for (const candidate of record.normalizedTitles) {
    if (candidate === normalizedQuery) best = Math.max(best, 10_000);
    else if (candidate.startsWith(`${normalizedQuery} `) || candidate.startsWith(normalizedQuery)) best = Math.max(best, 8_500);
    else if (candidate.includes(` ${normalizedQuery} `) || candidate.endsWith(` ${normalizedQuery}`)) best = Math.max(best, 7_200);
    else if (candidate.includes(normalizedQuery)) best = Math.max(best, 6_500);

    const compactCandidate = candidate.replace(/\s+/g, '');
    if (compactQuery.length >= 4 && compactCandidate === compactQuery) best = Math.max(best, 9_500);
    else if (compactQuery.length >= 4 && compactCandidate.startsWith(compactQuery)) best = Math.max(best, 8_000);
  }

  if (best === 0 && queryTokens.length > 1 && queryTokens.every((token) => record.normalizedCombined.includes(token))) {
    best = 5_000 + queryTokens.length * 50;
  }

  return best;
}

function getCachedSearch(key: string): LocalAnimeSearchResult[] | null {
  const cached = searchCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    searchCache.delete(key);
    return null;
  }
  // Refresh insertion order for simple LRU behavior.
  searchCache.delete(key);
  searchCache.set(key, cached);
  return cached.results.map((item) => ({ ...item }));
}

function setCachedSearch(key: string, results: LocalAnimeSearchResult[]): void {
  searchCache.delete(key);
  searchCache.set(key, {
    expiresAt: Date.now() + SEARCH_CACHE_TTL_MS,
    results: results.map((item) => ({ ...item })),
  });
  while (searchCache.size > SEARCH_CACHE_MAX) {
    const oldest = searchCache.keys().next().value;
    if (oldest === undefined) break;
    searchCache.delete(oldest);
  }
}

export async function searchLocalAnime(
  query: string,
  type: 'movie' | 'series',
  page = 1,
  pageSize = PAGE_SIZE,
): Promise<LocalAnimeSearchResult[]> {
  if (!initialized) {
    try {
      await initializeLocalAnimeSearch();
    } catch (error: any) {
      logger.warn(`Local anime search unavailable: ${error?.message || error}`);
      return [];
    }
  }

  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return [];

  const safePage = Math.max(1, Number(page) || 1);
  const safePageSize = Math.max(1, Math.min(50, Number(pageSize) || PAGE_SIZE));
  const cacheKey = `${type}|${safePage}|${safePageSize}|${normalizedQuery}`;
  const cachedResults = getCachedSearch(cacheKey);
  if (cachedResults) return cachedResults;

  const ranked = records
    .filter((record) => isTypeAllowed(record, type))
    .map((record) => ({ record, rank: rankRecord(record, normalizedQuery) }))
    .filter((item) => item.rank > 0)
    .sort((a, b) => {
      if (b.rank !== a.rank) return b.rank - a.rank;
      const scoreDiff = (b.record.score || 0) - (a.record.score || 0);
      if (scoreDiff !== 0) return scoreDiff;
      const yearDiff = (b.record.year || 0) - (a.record.year || 0);
      if (yearDiff !== 0) return yearDiff;
      return a.record.title.localeCompare(b.record.title);
    });

  // Resolve the local MAL-keyed records through AIOMetadata's already-loaded ID mapper.
  // This keeps the search itself local and gives downstream metadata/playback a native Kitsu ID.
  const mapped: LocalAnimeSearchResult[] = [];
  const seenKitsu = new Set<number>();
  for (const { record } of ranked) {
    const mapping = idMapper.getMappingByMalId(record.malId);
    const kitsuId = Number(mapping?.kitsu_id);
    if (!Number.isFinite(kitsuId) || kitsuId <= 0 || seenKitsu.has(kitsuId)) continue;
    seenKitsu.add(kitsuId);
    mapped.push({
      malId: record.malId,
      kitsuId,
      title: record.title,
      romajiTitle: record.romajiTitle,
      nativeTitle: record.nativeTitle,
      year: record.year,
      season: record.season,
      animeType: record.animeType,
      status: record.status,
      episodeCount: record.episodeCount,
      image: record.image,
      score: record.score,
    });
  }

  const start = (safePage - 1) * safePageSize;
  const pageResults = mapped.slice(start, start + safePageSize);
  setCachedSearch(cacheKey, pageResults);

  logger.info(`Local anime search matched ${pageResults.length} ${type} result(s) for "${query}" (${mapped.length} mapped total)`);
  return pageResults;
}

export function isKnownAnimeTitle(title: string, year?: number | string | null): boolean {
  if (!initialized) return false;
  const normalized = normalizeSearchText(title);
  if (!normalized) return false;
  const matches = exactTitleIndex.get(normalized) || [];
  if (!matches.length) return false;

  const numericYear = Number(year);
  if (!Number.isFinite(numericYear) || numericYear <= 0) return true;
  return matches.some((record) => !record.year || Math.abs(record.year - numericYear) <= 1);
}

export function getLocalAnimeSearchStats() {
  return {
    initialized,
    count: records.length,
    source: lastSource,
    lastLoadedAt: lastLoadedAt?.toISOString() || null,
    updateIntervalHours: updateIntervalHours(),
    kitsuFallback: isLocalAnimeKitsuFallbackEnabled(),
  };
}

export function selectLocalAnimeTitle(result: LocalAnimeSearchResult, language: string): string {
  const lang = String(language || '').toLowerCase();
  if (lang.startsWith('ja') && result.nativeTitle) return result.nativeTitle;
  return result.title || result.romajiTitle || result.nativeTitle || `Anime ${result.malId}`;
}

export const _test = { normalizeSearchText, compactSearchText, normalizeAnimeType, rankRecord };
