/**
 * Engine DJ (Engine Prime) m.db read/write.
 *
 * The m.db is a plain SQLite file located at:
 *   <volume>/Engine Library/Database2/m.db
 *
 * We open it with expo-sqlite by copying to a writable location,
 * performing reads/writes, then writing the modified bytes back via
 * expo-file-system. This is necessary because expo-sqlite can only
 * open files inside the app's document directory.
 *
 * Supported devices: Denon SC Live 2/3/4, Prime 2/4/4+, Prime Go,
 * SC5000/6000, any device that uses Engine DJ Library format.
 */
import * as FileSystem from 'expo-file-system';
import * as SQLite from 'expo-sqlite';
import { DBTrack, DBPlaylist, DBCuePoint, DBSavedLoop } from './LibraryDatabase';

export const ENGINE_DB_RELATIVE = 'Engine Library/Database2/m.db';
export const ENGINE_MUSIC_DIR   = 'Engine Library/Music';
export const ENGINE_PLAYLIST_DIR = 'Engine Library/Playlists';

const TMP_DIR = FileSystem.documentDirectory + 'engine_db_tmp/';

// ── Engine DJ schema types ─────────────────────────────────────────────────────

export interface EngineTrack {
  id: number;
  playOrder: number | null;
  length: number | null;
  lengthCalculated: number | null;
  bpm: number | null;
  year: number | null;
  path: string;
  filename: string;
  bitrate: number | null;
  bpmAnalyzed: number | null;
  title: string;
  artist: string;
  album: string;
  genre: string;
  comment: string;
  label: string;
  composer: string;
  fileType: number;
  isAnalyzed: number;
  dateAdded: number | null;
  isAvailable: number;
  isPerfomanceDataOfPackedTrackChanged: number;
  isRhythmAnalyzed: number;
  fileBytes: number | null;
  rating: number;
  musicBrainzId: string | null;
  pdbImportKey: number | null;
  uri: string | null;
  colorRed: number | null;
  colorGreen: number | null;
  colorBlue: number | null;
}

export interface EnginePlaylist {
  id: number;
  title: string;
  parentId: number | null;
  isPersisted: number;
  nextListId: number | null;
  firstTrackId: number | null;
  lastTrackId: number | null;
  flags: number;
}

export interface EngineSyncResult {
  tracksWritten: number;
  playlistsWritten: number;
  errors: string[];
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fileTypeFromExt(ext: string): number {
  switch (ext.toLowerCase()) {
    case 'mp3':  return 1;
    case 'aif':
    case 'aiff': return 2;
    case 'wav':  return 3;
    case 'flac': return 4;
    case 'ogg':  return 5;
    case 'mp4':
    case 'm4a':  return 6;
    case 'alac': return 7;
    default:     return 0;
  }
}

/** Build the Engine DJ-relative path for a track given an absolute file path and the volume root. */
export function engineRelativePath(absPath: string, volumeRoot: string): string {
  const root = volumeRoot.replace(/\/$/, '');
  const abs  = absPath.startsWith('/') ? absPath : '/' + absPath;
  if (abs.startsWith(root + '/')) {
    return abs.slice(root.length + 1);
  }
  // Fallback: use the last two path segments
  const parts = abs.split('/').filter(Boolean);
  return parts.length >= 2 ? parts.slice(-2).join('/') : parts[parts.length - 1] ?? '';
}

// ── Database open/copy ────────────────────────────────────────────────────────

async function ensureTmpDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(TMP_DIR);
  if (!info.exists) await FileSystem.makeDirectoryAsync(TMP_DIR, { intermediates: true });
}

/**
 * Copy the Engine DJ m.db from the external storage volume to a
 * writable temp location, open it with SQLite, and initialise tables
 * if it is a new/empty database.
 */
export async function openEngineDb(volumePath: string): Promise<SQLite.SQLiteDatabase | null> {
  try {
    await ensureTmpDir();
    const sourcePath = `${volumePath.replace(/\/$/, '')}/${ENGINE_DB_RELATIVE}`;
    const tmpPath = TMP_DIR + 'engine_m.db';

    // Check if source exists
    const srcInfo = await FileSystem.getInfoAsync('file://' + sourcePath);
    if (srcInfo.exists) {
      await FileSystem.copyAsync({ from: 'file://' + sourcePath, to: tmpPath });
    }
    // Open (creates new if not present)
    const db = await SQLite.openDatabaseAsync(tmpPath);
    await bootstrapEngineSchema(db);
    return db;
  } catch (e) {
    console.error('[EngineDJ] openEngineDb failed:', e);
    return null;
  }
}

/**
 * Write the temp m.db back to the external volume.
 */
export async function flushEngineDb(volumePath: string): Promise<boolean> {
  try {
    const tmpPath = TMP_DIR + 'engine_m.db';
    const destPath = `${volumePath.replace(/\/$/, '')}/${ENGINE_DB_RELATIVE}`;

    // Ensure Engine Library/Database2/ directory exists
    const dirPath = `${volumePath.replace(/\/$/, '')}/Engine Library/Database2`;
    await FileSystem.makeDirectoryAsync('file://' + dirPath, { intermediates: true }).catch(() => {});

    await FileSystem.copyAsync({ from: tmpPath, to: 'file://' + destPath });
    return true;
  } catch (e) {
    console.error('[EngineDJ] flushEngineDb failed:', e);
    return false;
  }
}

async function bootstrapEngineSchema(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(`PRAGMA journal_mode = WAL;`);
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS Track (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      playOrder INTEGER,
      length INTEGER,
      lengthCalculated INTEGER,
      bpm INTEGER,
      year INTEGER,
      path TEXT NOT NULL DEFAULT '',
      filename TEXT NOT NULL DEFAULT '',
      bitrate INTEGER,
      bpmAnalyzed REAL,
      albumArt INTEGER,
      label TEXT NOT NULL DEFAULT '',
      comment TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      artist TEXT NOT NULL DEFAULT '',
      album TEXT NOT NULL DEFAULT '',
      genre TEXT NOT NULL DEFAULT '',
      fileType INTEGER NOT NULL DEFAULT 0,
      isAnalyzed INTEGER NOT NULL DEFAULT 0,
      dateCreated INTEGER,
      dateAdded INTEGER,
      isAvailable INTEGER NOT NULL DEFAULT 1,
      isMetadataOfPackedTrackChanged INTEGER NOT NULL DEFAULT 0,
      isPerfomanceDataOfPackedTrackChanged INTEGER NOT NULL DEFAULT 0,
      playedIndicator INTEGER NOT NULL DEFAULT 0,
      isRhythmAnalyzed INTEGER NOT NULL DEFAULT 0,
      fileBytes INTEGER,
      pdbImportKey INTEGER,
      musicBrainzArtistId TEXT,
      musicBrainzAlbumId TEXT,
      musicBrainzId TEXT,
      musicBrainzLabelId TEXT,
      musicBrainzReleaseId TEXT,
      musicBrainzWorkId TEXT,
      pdbImportUri TEXT,
      streamingSource TEXT,
      uri TEXT,
      colorRed INTEGER,
      colorGreen INTEGER,
      colorBlue INTEGER,
      isPlaceholder INTEGER NOT NULL DEFAULT 0,
      isMetadataChanged INTEGER NOT NULL DEFAULT 0,
      rating INTEGER NOT NULL DEFAULT 0,
      freezeDate TEXT,
      isCrateTrack INTEGER NOT NULL DEFAULT 0,
      lastEditTime TEXT,
      lastEditTimestamp INTEGER
    );

    CREATE TABLE IF NOT EXISTS Playlist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL DEFAULT '',
      parentId INTEGER,
      isPersisted INTEGER NOT NULL DEFAULT 1,
      nextListId INTEGER,
      firstTrackId INTEGER,
      lastTrackId INTEGER,
      flags INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS PlaylistEntity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      listId INTEGER NOT NULL REFERENCES Playlist(id) ON DELETE CASCADE,
      trackId INTEGER NOT NULL REFERENCES Track(id) ON DELETE CASCADE,
      databaseUuid TEXT NOT NULL DEFAULT '',
      nextEntityId INTEGER,
      membershipReference INTEGER NOT NULL DEFAULT 0,
      dateAdded INTEGER
    );

    CREATE TABLE IF NOT EXISTS PerformanceData (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      isAnalyzed INTEGER NOT NULL DEFAULT 0,
      isRendered INTEGER NOT NULL DEFAULT 0,
      trackData BLOB,
      highResolutionWaveformData BLOB,
      overviewWaveformData BLOB,
      beatData BLOB,
      quickCues BLOB,
      loops BLOB,
      thirdPartySourceId INTEGER,
      activeOnLoadCueNum INTEGER NOT NULL DEFAULT -1,
      lastEditTime TEXT
    );

    CREATE TABLE IF NOT EXISTS Information (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT NOT NULL DEFAULT '',
      schemaVersionMajor INTEGER NOT NULL DEFAULT 2,
      schemaVersionMinor INTEGER NOT NULL DEFAULT 20,
      schemaVersionPatch INTEGER NOT NULL DEFAULT 0,
      currentPlayedIndiciator INTEGER NOT NULL DEFAULT 0,
      lastRekordboxLibraryImportReadCounter INTEGER NOT NULL DEFAULT 0
    );

    INSERT OR IGNORE INTO Information (id, uuid, schemaVersionMajor, schemaVersionMinor, schemaVersionPatch)
    VALUES (1, hex(randomblob(16)), 2, 20, 0);
  `);
}

// ── Read ───────────────────────────────────────────────────────────────────────

export async function readAllEngineTracks(volumePath: string): Promise<EngineTrack[]> {
  const db = await openEngineDb(volumePath);
  if (!db) return [];
  try {
    return await db.getAllAsync<EngineTrack>('SELECT * FROM Track ORDER BY artist, title');
  } finally {
    await db.closeAsync();
  }
}

export async function readAllEnginePlaylists(volumePath: string): Promise<EnginePlaylist[]> {
  const db = await openEngineDb(volumePath);
  if (!db) return [];
  try {
    return await db.getAllAsync<EnginePlaylist>('SELECT * FROM Playlist ORDER BY title');
  } finally {
    await db.closeAsync();
  }
}

export interface EnginePlaylistTrack {
  trackId: number;
  path: string;
  title: string;
  artist: string;
  bpm: number | null;
  bpmAnalyzed: number | null;
  position: number;
}

export async function readEnginePlaylistTracks(volumePath: string, playlistId: number): Promise<EnginePlaylistTrack[]> {
  const db = await openEngineDb(volumePath);
  if (!db) return [];
  try {
    return await db.getAllAsync<EnginePlaylistTrack>(`
      SELECT pe.trackId, t.path, t.title, t.artist, t.bpm, t.bpmAnalyzed,
             ROW_NUMBER() OVER (ORDER BY pe.id) - 1 as position
      FROM PlaylistEntity pe
      JOIN Track t ON t.id = pe.trackId
      WHERE pe.listId = ?
      ORDER BY pe.id
    `, [playlistId]);
  } catch {
    // Fallback without window functions (older SQLite)
    return await db.getAllAsync<EnginePlaylistTrack>(`
      SELECT pe.trackId, t.path, t.title, t.artist, t.bpm, t.bpmAnalyzed, pe.id as position
      FROM PlaylistEntity pe
      JOIN Track t ON t.id = pe.trackId
      WHERE pe.listId = ?
      ORDER BY pe.id
    `, [playlistId]);
  } finally {
    await db.closeAsync();
  }
}

// ── Write ──────────────────────────────────────────────────────────────────────

/**
 * Full sync: write all given tracks and playlists into the Engine DJ m.db
 * on the target volume, then flush the file back to storage.
 */
export async function syncToEngineDJ(
  volumePath: string,
  tracks: DBTrack[],
  playlists: Array<{ playlist: DBPlaylist; tracks: DBTrack[] }>,
  options: { overwrite?: boolean } = {},
): Promise<EngineSyncResult> {
  const result: EngineSyncResult = { tracksWritten: 0, playlistsWritten: 0, errors: [] };
  const db = await openEngineDb(volumePath);
  if (!db) {
    result.errors.push('Konnte m.db nicht öffnen');
    return result;
  }

  const volumeRoot = volumePath.replace(/\/$/, '');
  const trackIdMap = new Map<number, number>(); // local id → engine id

  try {
    // ── 1. Write tracks ──────────────────────────────────────────────────────
    for (const t of tracks) {
      try {
        const relPath = engineRelativePath(t.path, volumeRoot);
        const filename = t.path.split('/').pop() ?? t.filename;
        const ext = filename.split('.').pop() ?? '';
        const fileType = fileTypeFromExt(ext);
        const bpmInt = t.bpm ? Math.round(t.bpm * 100) : null;

        // Check if track already exists by path
        const existing = await db.getFirstAsync<{id:number}>(
          'SELECT id FROM Track WHERE path=? OR filename=?',
          [relPath, filename],
        );

        if (existing && !options.overwrite) {
          trackIdMap.set(t.id, existing.id);
          continue;
        }

        if (existing) {
          await db.runAsync(
            `UPDATE Track SET title=?,artist=?,album=?,genre=?,comment=?,label=?,
             bpm=?,bpmAnalyzed=?,year=?,fileType=?,isAnalyzed=?,rating=?,
             colorRed=?,colorGreen=?,colorBlue=?,lastEditTime=datetime('now')
             WHERE id=?`,
            [t.title||'', t.artist||'', t.album||'', t.genre||'',
             t.comment||'', t.label||'', bpmInt, t.bpm_analyzed ?? null,
             t.year ?? null, fileType, t.is_analyzed,
             Math.min(5, Math.round(t.rating/20)),
             t.color_r, t.color_g, t.color_b, existing.id],
          );
          trackIdMap.set(t.id, existing.id);
        } else {
          const r = await db.runAsync(
            `INSERT INTO Track
               (path, filename, title, artist, album, genre, comment, label,
                bpm, bpmAnalyzed, year, fileType, isAnalyzed, isAvailable,
                rating, colorRed, colorGreen, colorBlue,
                dateAdded, lastEditTime)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,strftime('%s','now'),datetime('now'))`,
            [relPath, filename, t.title||'', t.artist||'', t.album||'', t.genre||'',
             t.comment||'', t.label||'',
             bpmInt, t.bpm_analyzed ?? null, t.year ?? null, fileType, t.is_analyzed,
             Math.min(5, Math.round(t.rating/20)),
             t.color_r, t.color_g, t.color_b],
          );
          trackIdMap.set(t.id, r.lastInsertRowId);

          // Insert placeholder PerformanceData
          await db.runAsync(
            'INSERT INTO PerformanceData (isAnalyzed, isRendered, activeOnLoadCueNum) VALUES (?,0,-1)',
            [t.is_analyzed],
          );
        }
        result.tracksWritten++;
      } catch (e: any) {
        result.errors.push(`Track ${t.path}: ${e?.message ?? e}`);
      }
    }

    // ── 2. Write playlists ───────────────────────────────────────────────────
    for (const { playlist: pl, tracks: plTracks } of playlists) {
      try {
        let enginePlaylistId: number;

        const existing = await db.getFirstAsync<{id:number}>(
          'SELECT id FROM Playlist WHERE title=?', [pl.title],
        );

        if (existing) {
          enginePlaylistId = existing.id;
          // Clear existing entries to rebuild
          await db.runAsync('DELETE FROM PlaylistEntity WHERE listId=?', [enginePlaylistId]);
        } else {
          const r = await db.runAsync(
            'INSERT INTO Playlist (title, isPersisted, flags) VALUES (?,1,0)',
            [pl.title],
          );
          enginePlaylistId = r.lastInsertRowId;
        }

        // Insert playlist entries
        for (const t of plTracks) {
          const engineTrackId = trackIdMap.get(t.id);
          if (!engineTrackId) continue;
          await db.runAsync(
            `INSERT INTO PlaylistEntity (listId, trackId, databaseUuid, membershipReference, dateAdded)
             VALUES (?,?,hex(randomblob(16)),0,strftime('%s','now'))`,
            [enginePlaylistId, engineTrackId],
          );
        }

        result.playlistsWritten++;
      } catch (e: any) {
        result.errors.push(`Playlist ${pl.title}: ${e?.message ?? e}`);
      }
    }

    // ── 3. Write M3U8 sidecar files for compatibility ────────────────────────
    await writeM3U8Files(volumePath, playlists, trackIdMap, tracks);

  } finally {
    await db.closeAsync();
  }

  // Flush back to external storage
  const flushed = await flushEngineDb(volumePath);
  if (!flushed) result.errors.push('Konnte m.db nicht auf das Medium schreiben');

  return result;
}

// ── Cue + Loop sync ────────────────────────────────────────────────────────────

/**
 * Write hot cues and loops for a track into PerformanceData.
 * The binary format used by Engine DJ for quickCues is:
 *   [count:u8][for each: type:u8 position:f64le label:pascal-str color:u8u8u8]
 */
export async function writeCuesAndLoops(
  volumePath: string,
  engineTrackId: number,
  hotCues: DBCuePoint[],
  loops: DBSavedLoop[],
): Promise<boolean> {
  const db = await openEngineDb(volumePath);
  if (!db) return false;
  try {
    const quickCues = encodeQuickCues(hotCues);
    const loopsBlob = encodeLoops(loops);
    await db.runAsync(
      `UPDATE PerformanceData SET quickCues=?, loops=?, isAnalyzed=1, lastEditTime=datetime('now')
       WHERE id=?`,
      [quickCues, loopsBlob, engineTrackId],
    );
    return true;
  } catch {
    return false;
  } finally {
    await db.closeAsync();
    await flushEngineDb(volumePath);
  }
}

// The Engine DJ quickCues binary blob (simplified, enough to import on hardware)
function encodeQuickCues(cues: DBCuePoint[]): number[] {
  const hot = cues.filter(c => c.is_hot_cue).slice(0, 8);
  const buf: number[] = [hot.length];
  for (const c of hot) {
    buf.push(c.hot_cue_number ?? 0); // hot cue slot (0-7)
    // Position as ms stored as 4-byte uint
    const pos = Math.round(c.position_ms);
    buf.push((pos >> 24) & 0xFF, (pos >> 16) & 0xFF, (pos >> 8) & 0xFF, pos & 0xFF);
    buf.push(c.color_r, c.color_g, c.color_b);
    // Label as length-prefixed ASCII
    const labelBytes = [...c.label.substring(0, 32)].map(ch => ch.charCodeAt(0) & 0xFF);
    buf.push(labelBytes.length, ...labelBytes);
  }
  return buf;
}

function encodeLoops(loops: DBSavedLoop[]): number[] {
  const buf: number[] = [loops.length];
  for (const l of loops) {
    const start = Math.round(l.start_ms);
    const end   = Math.round(l.end_ms);
    buf.push((start >> 24)&0xFF,(start >> 16)&0xFF,(start >> 8)&0xFF,start&0xFF);
    buf.push((end   >> 24)&0xFF,(end   >> 16)&0xFF,(end   >> 8)&0xFF,end  &0xFF);
    buf.push(l.color_r, l.color_g, l.color_b);
    const labelBytes = [...l.label.substring(0, 32)].map(ch => ch.charCodeAt(0) & 0xFF);
    buf.push(labelBytes.length, ...labelBytes);
  }
  return buf;
}

// ── M3U8 sidecar files ─────────────────────────────────────────────────────────

async function writeM3U8Files(
  volumePath: string,
  playlists: Array<{ playlist: DBPlaylist; tracks: DBTrack[] }>,
  _trackIdMap: Map<number, number>,
  _allTracks: DBTrack[],
): Promise<void> {
  const plDir = `${volumePath.replace(/\/$/, '')}/${ENGINE_PLAYLIST_DIR}`;
  try {
    await FileSystem.makeDirectoryAsync('file://' + plDir, { intermediates: true });
  } catch {}

  for (const { playlist: pl, tracks } of playlists) {
    try {
      const safe = pl.title.replace(/[\\/:*?"<>|]/g, '_');
      const m3uPath = `${plDir}/${safe}.m3u8`;
      const lines = ['#EXTM3U', `#PLAYLIST:${pl.title}`];
      for (const t of tracks) {
        const durSec = t.duration_ms ? Math.round(t.duration_ms / 1000) : -1;
        const info = [t.artist, t.title].filter(Boolean).join(' - ') || t.filename;
        let extInf = `#EXTINF:${durSec}`;
        if (t.bpm)         extInf += `,bpm=${t.bpm.toFixed(1)}`;
        if (t.key_camelot) extInf += `,key=${t.key_camelot}`;
        extInf += `,${info}`;
        lines.push(extInf, t.path);
      }
      await FileSystem.writeAsStringAsync('file://' + m3uPath, lines.join('\n'), { encoding: 'utf8' });
    } catch {}
  }
}

// ── Volume detection ───────────────────────────────────────────────────────────

export interface EngineVolume {
  path: string;
  label: string;
  type: 'sd' | 'usb' | 'internal';
  hasEngineLibrary: boolean;
  trackCount: number;
}

const VOLUME_CANDIDATES: Array<{ path: string; label: string; type: 'sd'|'usb'|'internal' }> = [
  { path: '/storage/emulated/0',     label: 'Interner Speicher',   type: 'internal' },
  { path: '/storage/sdcard0',        label: 'SD-Karte (sdcard0)',  type: 'sd'       },
  { path: '/storage/sdcard1',        label: 'SD-Karte (sdcard1)',  type: 'sd'       },
  { path: '/storage/extSdCard',      label: 'SD-Karte (ext)',      type: 'sd'       },
  { path: '/storage/external_sd',    label: 'SD-Karte (extern)',   type: 'sd'       },
  { path: '/mnt/sdcard',             label: 'SD-Karte (mnt)',      type: 'sd'       },
  { path: '/mnt/extSdCard',          label: 'SD-Karte (extmnt)',   type: 'sd'       },
  { path: '/mnt/media_rw/sdcard1',   label: 'SD-Karte (rw)',       type: 'sd'       },
  { path: '/storage/usb0',           label: 'USB-Stick (usb0)',    type: 'usb'      },
  { path: '/storage/usb1',           label: 'USB-Stick (usb1)',    type: 'usb'      },
  { path: '/storage/usbdisk',        label: 'USB-Stick',           type: 'usb'      },
  { path: '/storage/UsbDriveA',      label: 'USB-Stick A',         type: 'usb'      },
  { path: '/storage/UsbDriveB',      label: 'USB-Stick B',         type: 'usb'      },
  { path: '/mnt/usb_storage',        label: 'USB-Speicher',        type: 'usb'      },
  { path: '/mnt/usb',                label: 'USB (mnt)',           type: 'usb'      },
  { path: '/mnt/media_rw/usb0',      label: 'USB (usb0/rw)',       type: 'usb'      },
  { path: '/mnt/media_rw/usb1',      label: 'USB (usb1/rw)',       type: 'usb'      },
  { path: '/mnt/media_rw/udisk0',    label: 'USB-Disk 0',          type: 'usb'      },
  { path: '/mnt/media_rw/udisk1',    label: 'USB-Disk 1',          type: 'usb'      },
];

export async function detectEngineVolumes(): Promise<EngineVolume[]> {
  const found: EngineVolume[] = [];
  for (const c of VOLUME_CANDIDATES) {
    try {
      const info = await FileSystem.getInfoAsync('file://' + c.path);
      if (!info.exists) continue;

      const dbPath = `${c.path}/${ENGINE_DB_RELATIVE}`;
      const dbInfo = await FileSystem.getInfoAsync('file://' + dbPath);

      let trackCount = 0;
      if (dbInfo.exists) {
        try {
          const db = await openEngineDb(c.path);
          if (db) {
            const row = await db.getFirstAsync<{n:number}>('SELECT COUNT(*) as n FROM Track');
            trackCount = row?.n ?? 0;
            await db.closeAsync();
          }
        } catch {}
      }

      found.push({
        path: c.path,
        label: c.label,
        type: c.type,
        hasEngineLibrary: dbInfo.exists,
        trackCount,
      });
    } catch {}
  }
  return found;
}

// ── Import Engine DJ library into local DB ────────────────────────────────────

export async function importEngineLibrary(
  volumePath: string,
  onProgress?: (done: number, total: number) => void,
): Promise<{ tracks: number; playlists: number; errors: string[] }> {
  const { upsertTrack, createPlaylist, addTrackToPlaylist, getTrackByPath } = await import('./LibraryDatabase');

  const errors: string[] = [];
  let tracksImported = 0;
  let playlistsImported = 0;

  const db = await openEngineDb(volumePath);
  if (!db) return { tracks: 0, playlists: 0, errors: ['Konnte m.db nicht öffnen'] };

  try {
    const engineTracks = await db.getAllAsync<EngineTrack>('SELECT * FROM Track');
    const total = engineTracks.length;

    for (let i = 0; i < engineTracks.length; i++) {
      const et = engineTracks[i];
      try {
        const absPath = et.path.startsWith('/')
          ? et.path
          : `${volumePath.replace(/\/$/, '')}/${et.path}`;
        const ext = et.filename.split('.').pop()?.toLowerCase() ?? '';

        await upsertTrack({
          path: absPath, filename: et.filename, folder: absPath.split('/').slice(0, -1).pop() ?? '',
          title: et.title || et.filename.replace(/\.[^.]+$/, ''),
          artist: et.artist || '', album: et.album || '',
          genre: et.genre || '', year: et.year ?? null,
          duration_ms: et.length ? et.length * 1000 : null,
          bpm: et.bpm ? et.bpm / 100 : null,
          bpm_analyzed: et.bpmAnalyzed ?? null,
          key_camelot: null, key_open: null, key_musical: null,
          lufs: null, rms_db: null, peak_db: null,
          bitrate: et.bitrate ?? null, file_size: et.fileBytes ?? null,
          file_type: ext, rating: (et.rating ?? 0) * 20,
          comment: et.comment || '', label: et.label || '',
          color_r: et.colorRed ?? 0, color_g: et.colorGreen ?? 0, color_b: et.colorBlue ?? 0,
          is_analyzed: et.isAnalyzed,
          date_added: new Date().toISOString(), date_modified: null,
          engine_id: et.id, artwork_uri: null,
        });
        tracksImported++;
      } catch (e: any) {
        errors.push(`Track ${et.filename}: ${e?.message ?? e}`);
      }
      onProgress?.(i + 1, total);
    }

    // Import playlists
    const enginePlaylists = await db.getAllAsync<EnginePlaylist>('SELECT * FROM Playlist');
    for (const ep of enginePlaylists) {
      try {
        const plId = await createPlaylist(ep.title);
        const entities = await db.getAllAsync<{trackId:number}>(
          'SELECT trackId FROM PlaylistEntity WHERE listId=? ORDER BY id', [ep.id],
        );
        for (let pos = 0; pos < entities.length; pos++) {
          const eid = entities[pos].trackId;
          const et2 = engineTracks.find(t => t.id === eid);
          if (!et2) continue;
          const absPath = et2.path.startsWith('/')
            ? et2.path
            : `${volumePath.replace(/\/$/, '')}/${et2.path}`;
          const localTrack = await getTrackByPath(absPath);
          if (localTrack) await addTrackToPlaylist(plId, localTrack.id, pos);
        }
        playlistsImported++;
      } catch (e: any) {
        errors.push(`Playlist ${ep.title}: ${e?.message ?? e}`);
      }
    }
  } finally {
    await db.closeAsync();
  }

  return { tracks: tracksImported, playlists: playlistsImported, errors };
}
