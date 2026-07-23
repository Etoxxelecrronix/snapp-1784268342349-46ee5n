import * as FileSystem from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const MUSIC_EXTENSIONS = /\.(mp3|flac|aif|aiff|wav|ogg|m4a|alac|aac)$/i;

const MAX_DEPTH = 10;
const YIELD_INTERVAL_MS = 14;
const SCAN_CACHE_KEY = '@dj_scan_cache_v3';

export interface ScanTrack {
  name: string;
  path: string;
  folder: string;
  folderPath: string;
  extension: string;
  isNew?: boolean;
}

export interface FolderStat {
  name: string;
  path: string;
  trackCount: number;
  newCount: number;
  tracks: ScanTrack[];
}

export interface ScanProgress {
  scanned: number;
  found: number;
  currentPath: string;
  phase: 'scanning' | 'done';
}

export interface ScanResult {
  folders: FolderStat[];
  totalTracks: number;
  newTrackCount: number;
  removedTrackCount: number;
  durationMs: number;
}

interface CacheEntry {
  rootPath: string;
  tracks: ScanTrack[];
  scannedAt: string;
}

const SAF_API = (FileSystem as any).StorageAccessFramework as {
  readDirectoryAsync: (uri: string) => Promise<string[]>;
  readAsStringAsync?: (uri: string, opts: any) => Promise<string>;
} | null;

const isSaf = (p: string) => typeof p === 'string' && p.startsWith('content://');

function getSafName(uri: string): string {
  try {
    const decoded = decodeURIComponent(uri);
    const colonIdx = decoded.lastIndexOf(':');
    const path = colonIdx > -1 ? decoded.substring(colonIdx + 1) : decoded;
    return path.split('/').pop() || '';
  } catch {
    return '';
  }
}

let _lastYield = 0;
async function maybeYield(): Promise<void> {
  const now = Date.now();
  if (now - _lastYield >= YIELD_INTERVAL_MS) {
    await new Promise<void>(r => setTimeout(r, 0));
    _lastYield = Date.now();
  }
}

// ── file:// recursive scan ────────────────────────────────────────────────────

async function scanFileDir(
  dirPath: string,
  depth: number,
  tracks: ScanTrack[],
  folderStats: Map<string, FolderStat>,
  scanned: { count: number },
  onProgress: (p: ScanProgress) => void,
): Promise<void> {
  if (depth > MAX_DEPTH) return;

  const uri = dirPath.startsWith('file://') ? dirPath : 'file://' + dirPath;
  const normalPath = dirPath.startsWith('file://') ? dirPath.slice(7) : dirPath;

  let entries: string[];
  try {
    entries = await FileSystem.readDirectoryAsync(uri);
  } catch {
    return;
  }

  scanned.count++;
  const folderName = normalPath.split('/').pop() || normalPath;
  const musicFilenames: string[] = [];
  const subDirPaths: string[] = [];

  for (const entry of entries) {
    if (entry.startsWith('.')) continue;
    const childPath = normalPath.replace(/\/$/, '') + '/' + entry;

    if (MUSIC_EXTENSIONS.test(entry)) {
      musicFilenames.push(entry);
    } else {
      try {
        const info = await FileSystem.getInfoAsync('file://' + childPath);
        if ((info as any).isDirectory === true) {
          subDirPaths.push(childPath);
        }
      } catch {
        // not accessible, skip
      }
    }
  }

  if (musicFilenames.length > 0) {
    let stat = folderStats.get(normalPath);
    if (!stat) {
      stat = { name: folderName, path: normalPath, trackCount: 0, newCount: 0, tracks: [] };
      folderStats.set(normalPath, stat);
    }
    for (const filename of musicFilenames) {
      const track: ScanTrack = {
        name: filename,
        path: normalPath + '/' + filename,
        folder: folderName,
        folderPath: normalPath,
        extension: filename.split('.').pop()?.toLowerCase() ?? '',
      };
      tracks.push(track);
      stat.tracks.push(track);
    }
    stat.trackCount = stat.tracks.length;
    onProgress({ scanned: scanned.count, found: tracks.length, currentPath: folderName, phase: 'scanning' });
    await maybeYield();
  }

  for (const sub of subDirPaths) {
    await scanFileDir(sub, depth + 1, tracks, folderStats, scanned, onProgress);
  }
}

// ── SAF (content://) recursive scan ──────────────────────────────────────────

async function scanSafDir(
  dirUri: string,
  depth: number,
  tracks: ScanTrack[],
  folderStats: Map<string, FolderStat>,
  scanned: { count: number },
  onProgress: (p: ScanProgress) => void,
): Promise<void> {
  if (depth > MAX_DEPTH || !SAF_API) return;

  let entries: string[];
  try {
    entries = await SAF_API.readDirectoryAsync(dirUri);
  } catch {
    return;
  }

  scanned.count++;
  const folderName = getSafName(dirUri) || 'Root';
  const musicEntries: Array<{ name: string; uri: string }> = [];
  const subDirUris: string[] = [];

  for (const entry of entries) {
    const name = getSafName(entry);
    if (!name || name.startsWith('.')) continue;

    if (MUSIC_EXTENSIONS.test(name)) {
      musicEntries.push({ name, uri: entry });
    } else {
      // Check if directory by attempting to list it
      const children = await SAF_API.readDirectoryAsync(entry).catch(() => null as string[] | null);
      if (children !== null) {
        subDirUris.push(entry);
      }
    }
    await maybeYield();
  }

  if (musicEntries.length > 0) {
    let stat = folderStats.get(dirUri);
    if (!stat) {
      stat = { name: folderName, path: dirUri, trackCount: 0, newCount: 0, tracks: [] };
      folderStats.set(dirUri, stat);
    }
    for (const { name, uri } of musicEntries) {
      const track: ScanTrack = {
        name,
        path: uri,
        folder: folderName,
        folderPath: dirUri,
        extension: name.split('.').pop()?.toLowerCase() ?? '',
      };
      tracks.push(track);
      stat.tracks.push(track);
    }
    stat.trackCount = stat.tracks.length;
    onProgress({ scanned: scanned.count, found: tracks.length, currentPath: folderName, phase: 'scanning' });
    await maybeYield();
  }

  for (const sub of subDirUris) {
    await scanSafDir(sub, depth + 1, tracks, folderStats, scanned, onProgress);
  }
}

// ── Cache helpers ─────────────────────────────────────────────────────────────

async function loadCache(): Promise<CacheEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(SCAN_CACHE_KEY);
    return raw ? (JSON.parse(raw) as CacheEntry[]) : [];
  } catch {
    return [];
  }
}

async function saveCache(entries: CacheEntry[]): Promise<void> {
  try {
    // Keep last 5 root paths to avoid unbounded growth
    const trimmed = entries.slice(-5);
    await AsyncStorage.setItem(SCAN_CACHE_KEY, JSON.stringify(trimmed));
  } catch {}
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function scanMusicLibrary(
  rootPath: string,
  onProgress: (p: ScanProgress) => void,
): Promise<ScanResult> {
  const startMs = Date.now();
  _lastYield = startMs;

  const tracks: ScanTrack[] = [];
  const folderStats = new Map<string, FolderStat>();
  const scanned = { count: 0 };

  if (isSaf(rootPath)) {
    await scanSafDir(rootPath, 0, tracks, folderStats, scanned, onProgress);
  } else {
    await scanFileDir(rootPath, 0, tracks, folderStats, scanned, onProgress);
  }

  // Detect changes vs cache
  const cache = await loadCache();
  const prior = cache.find(c => c.rootPath === rootPath);
  const cachedPaths = new Set(prior?.tracks.map(t => t.path) ?? []);
  const currentPaths = new Set(tracks.map(t => t.path));

  let newTrackCount = 0;
  let removedTrackCount = 0;

  for (const track of tracks) {
    if (!cachedPaths.has(track.path)) {
      track.isNew = true;
      newTrackCount++;
    }
  }
  for (const p of cachedPaths) {
    if (!currentPaths.has(p)) removedTrackCount++;
  }

  // Propagate isNew counts to folders
  for (const [, stat] of folderStats) {
    stat.newCount = stat.tracks.filter(t => t.isNew).length;
  }

  // Persist updated cache
  const updatedCache = cache.filter(c => c.rootPath !== rootPath);
  updatedCache.push({ rootPath, tracks, scannedAt: new Date().toISOString() });
  await saveCache(updatedCache);

  onProgress({ scanned: scanned.count, found: tracks.length, currentPath: '', phase: 'done' });

  return {
    folders: [...folderStats.values()].sort((a, b) => b.trackCount - a.trackCount),
    totalTracks: tracks.length,
    newTrackCount,
    removedTrackCount,
    durationMs: Date.now() - startMs,
  };
}

/** Clears the scan cache for a specific root path (call when user disconnects media). */
export async function clearScanCache(rootPath?: string): Promise<void> {
  try {
    if (rootPath) {
      const cache = await loadCache();
      await saveCache(cache.filter(c => c.rootPath !== rootPath));
    } else {
      await AsyncStorage.removeItem(SCAN_CACHE_KEY);
    }
  } catch {}
}
