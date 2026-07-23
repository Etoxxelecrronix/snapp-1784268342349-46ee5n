/**
 * Local SQLite library database.
 * Stores tracks, playlists, cue points, hot cues, saved loops,
 * beatgrids and analysis results — all fully offline.
 */
import * as SQLite from 'expo-sqlite';

let _db: SQLite.SQLiteDatabase | null = null;

async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (_db) return _db;
  _db = await SQLite.openDatabaseAsync('dj_library_v1.db');
  await initSchema(_db);
  return _db;
}

async function initSchema(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(`PRAGMA journal_mode = WAL;`);
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS tracks (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      path            TEXT    NOT NULL UNIQUE,
      filename        TEXT    NOT NULL,
      folder          TEXT    NOT NULL DEFAULT '',
      title           TEXT    NOT NULL DEFAULT '',
      artist          TEXT    NOT NULL DEFAULT '',
      album           TEXT    NOT NULL DEFAULT '',
      genre           TEXT    NOT NULL DEFAULT '',
      year            INTEGER,
      duration_ms     INTEGER,
      bpm             REAL,
      bpm_analyzed    REAL,
      key_camelot     TEXT,
      key_open        TEXT,
      key_musical     TEXT,
      lufs            REAL,
      rms_db          REAL,
      peak_db         REAL,
      bitrate         INTEGER,
      file_size       INTEGER,
      file_type       TEXT    NOT NULL DEFAULT '',
      rating          INTEGER DEFAULT 0,
      comment         TEXT    NOT NULL DEFAULT '',
      label           TEXT    NOT NULL DEFAULT '',
      color_r         INTEGER DEFAULT 0,
      color_g         INTEGER DEFAULT 0,
      color_b         INTEGER DEFAULT 0,
      is_analyzed     INTEGER DEFAULT 0,
      date_added      TEXT    NOT NULL DEFAULT (datetime('now')),
      date_modified   TEXT,
      engine_id       INTEGER,
      artwork_uri     TEXT
    );

    CREATE TABLE IF NOT EXISTS playlists (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      title           TEXT    NOT NULL,
      parent_id       INTEGER REFERENCES playlists(id) ON DELETE SET NULL,
      is_folder       INTEGER DEFAULT 0,
      color_r         INTEGER DEFAULT 0,
      color_g         INTEGER DEFAULT 0,
      color_b         INTEGER DEFAULT 0,
      created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
      synced_at       TEXT,
      engine_id       INTEGER,
      track_count     INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS playlist_tracks (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      playlist_id     INTEGER NOT NULL REFERENCES playlists(id)  ON DELETE CASCADE,
      track_id        INTEGER NOT NULL REFERENCES tracks(id)     ON DELETE CASCADE,
      position        INTEGER NOT NULL DEFAULT 0,
      date_added      TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(playlist_id, track_id)
    );

    CREATE TABLE IF NOT EXISTS cue_points (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      track_id        INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
      type            INTEGER NOT NULL DEFAULT 0,
      position_ms     REAL    NOT NULL,
      length_ms       REAL    DEFAULT 0,
      label           TEXT    NOT NULL DEFAULT '',
      color_r         INTEGER DEFAULT 255,
      color_g         INTEGER DEFAULT 165,
      color_b         INTEGER DEFAULT 0,
      is_hot_cue      INTEGER DEFAULT 0,
      hot_cue_number  INTEGER,
      created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS saved_loops (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      track_id        INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
      start_ms        REAL    NOT NULL,
      end_ms          REAL    NOT NULL,
      label           TEXT    NOT NULL DEFAULT '',
      color_r         INTEGER DEFAULT 0,
      color_g         INTEGER DEFAULT 255,
      color_b         INTEGER DEFAULT 0,
      created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS beatgrids (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      track_id        INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
      bpm             REAL    NOT NULL,
      offset_ms       REAL    NOT NULL DEFAULT 0,
      is_downbeat     INTEGER DEFAULT 0,
      beat_number     INTEGER,
      created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS analysis_results (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      track_id        INTEGER NOT NULL UNIQUE REFERENCES tracks(id) ON DELETE CASCADE,
      bpm             REAL,
      bpm_confidence  REAL,
      tempo_stability REAL,
      key_camelot     TEXT,
      key_open        TEXT,
      key_musical     TEXT,
      key_confidence  REAL,
      lufs            REAL,
      rms_db          REAL,
      peak_db         REAL,
      waveform_json   TEXT,
      beat_grid_json  TEXT,
      duration_ms     REAL,
      analyzed_at     TEXT    NOT NULL DEFAULT (datetime('now')),
      analyzer_ver    TEXT    NOT NULL DEFAULT '1.0'
    );

    CREATE INDEX IF NOT EXISTS idx_playlist_tracks_pl   ON playlist_tracks(playlist_id, position);
    CREATE INDEX IF NOT EXISTS idx_playlist_tracks_tr   ON playlist_tracks(track_id);
    CREATE INDEX IF NOT EXISTS idx_cue_points_track     ON cue_points(track_id, position_ms);
    CREATE INDEX IF NOT EXISTS idx_saved_loops_track    ON saved_loops(track_id);
    CREATE INDEX IF NOT EXISTS idx_beatgrids_track      ON beatgrids(track_id);
    CREATE INDEX IF NOT EXISTS idx_tracks_path          ON tracks(path);
    CREATE INDEX IF NOT EXISTS idx_tracks_artist        ON tracks(artist);
    CREATE INDEX IF NOT EXISTS idx_tracks_bpm           ON tracks(bpm);
  `);
}

// ── Types ──────────────────────────────────────────────────────────────────────

export interface DBTrack {
  id: number;
  path: string;
  filename: string;
  folder: string;
  title: string;
  artist: string;
  album: string;
  genre: string;
  year: number | null;
  duration_ms: number | null;
  bpm: number | null;
  bpm_analyzed: number | null;
  key_camelot: string | null;
  key_open: string | null;
  key_musical: string | null;
  lufs: number | null;
  rms_db: number | null;
  peak_db: number | null;
  bitrate: number | null;
  file_size: number | null;
  file_type: string;
  rating: number;
  comment: string;
  label: string;
  color_r: number;
  color_g: number;
  color_b: number;
  is_analyzed: number;
  date_added: string;
  date_modified: string | null;
  engine_id: number | null;
  artwork_uri: string | null;
}

export interface DBPlaylist {
  id: number;
  title: string;
  parent_id: number | null;
  is_folder: number;
  color_r: number;
  color_g: number;
  color_b: number;
  created_at: string;
  synced_at: string | null;
  engine_id: number | null;
  track_count: number;
}

export interface DBCuePoint {
  id: number;
  track_id: number;
  type: number;
  position_ms: number;
  length_ms: number;
  label: string;
  color_r: number;
  color_g: number;
  color_b: number;
  is_hot_cue: number;
  hot_cue_number: number | null;
  created_at: string;
}

export interface DBSavedLoop {
  id: number;
  track_id: number;
  start_ms: number;
  end_ms: number;
  label: string;
  color_r: number;
  color_g: number;
  color_b: number;
  created_at: string;
}

export interface DBBeatgrid {
  id: number;
  track_id: number;
  bpm: number;
  offset_ms: number;
  is_downbeat: number;
  beat_number: number | null;
  created_at: string;
}

export interface DBAnalysisResult {
  id: number;
  track_id: number;
  bpm: number | null;
  bpm_confidence: number | null;
  tempo_stability: number | null;
  key_camelot: string | null;
  key_open: string | null;
  key_musical: string | null;
  key_confidence: number | null;
  lufs: number | null;
  rms_db: number | null;
  peak_db: number | null;
  waveform_json: string | null;
  beat_grid_json: string | null;
  duration_ms: number | null;
  analyzed_at: string;
  analyzer_ver: string;
}

// ── Track CRUD ─────────────────────────────────────────────────────────────────

export async function upsertTrack(t: Omit<DBTrack, 'id'>): Promise<number> {
  const db = await getDb();
  const result = await db.runAsync(
    `INSERT INTO tracks
       (path, filename, folder, title, artist, album, genre, year,
        duration_ms, bpm, bpm_analyzed, key_camelot, key_open, key_musical,
        lufs, rms_db, peak_db, bitrate, file_size, file_type, rating,
        comment, label, color_r, color_g, color_b, is_analyzed,
        date_added, date_modified, engine_id, artwork_uri)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(path) DO UPDATE SET
       filename=excluded.filename, folder=excluded.folder,
       title=excluded.title, artist=excluded.artist,
       album=excluded.album, genre=excluded.genre, year=excluded.year,
       duration_ms=excluded.duration_ms, bpm=excluded.bpm,
       bpm_analyzed=excluded.bpm_analyzed,
       key_camelot=excluded.key_camelot, key_open=excluded.key_open,
       key_musical=excluded.key_musical,
       lufs=excluded.lufs, rms_db=excluded.rms_db, peak_db=excluded.peak_db,
       bitrate=excluded.bitrate, file_size=excluded.file_size,
       file_type=excluded.file_type, rating=excluded.rating,
       comment=excluded.comment, label=excluded.label,
       color_r=excluded.color_r, color_g=excluded.color_g, color_b=excluded.color_b,
       is_analyzed=excluded.is_analyzed, date_modified=datetime('now'),
       engine_id=excluded.engine_id, artwork_uri=excluded.artwork_uri`,
    [t.path, t.filename, t.folder, t.title, t.artist, t.album, t.genre,
     t.year ?? null, t.duration_ms ?? null, t.bpm ?? null, t.bpm_analyzed ?? null,
     t.key_camelot ?? null, t.key_open ?? null, t.key_musical ?? null,
     t.lufs ?? null, t.rms_db ?? null, t.peak_db ?? null,
     t.bitrate ?? null, t.file_size ?? null, t.file_type,
     t.rating, t.comment, t.label,
     t.color_r, t.color_g, t.color_b, t.is_analyzed,
     t.date_added, t.date_modified ?? null, t.engine_id ?? null, t.artwork_uri ?? null],
  );
  const row = await db.getFirstAsync<{id:number}>('SELECT id FROM tracks WHERE path=?', [t.path]);
  return row?.id ?? result.lastInsertRowId;
}

export async function getTrackByPath(path: string): Promise<DBTrack | null> {
  const db = await getDb();
  return db.getFirstAsync<DBTrack>('SELECT * FROM tracks WHERE path=?', [path]);
}

export async function getTrackById(id: number): Promise<DBTrack | null> {
  const db = await getDb();
  return db.getFirstAsync<DBTrack>('SELECT * FROM tracks WHERE id=?', [id]);
}

export async function getAllTracks(orderBy = 'artist ASC, title ASC'): Promise<DBTrack[]> {
  const db = await getDb();
  return db.getAllAsync<DBTrack>(`SELECT * FROM tracks ORDER BY ${orderBy}`);
}

export async function searchTracks(query: string): Promise<DBTrack[]> {
  const db = await getDb();
  const q = `%${query}%`;
  return db.getAllAsync<DBTrack>(
    'SELECT * FROM tracks WHERE title LIKE ? OR artist LIKE ? OR album LIKE ? OR path LIKE ? ORDER BY artist, title',
    [q, q, q, q],
  );
}

export async function updateTrackRating(id: number, rating: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE tracks SET rating=?, date_modified=datetime(\'now\') WHERE id=?', [rating, id]);
}

export async function updateTrackAnalysis(id: number, data: {
  bpm?: number | null; bpm_analyzed?: number | null;
  key_camelot?: string | null; key_open?: string | null; key_musical?: string | null;
  lufs?: number | null; rms_db?: number | null; peak_db?: number | null;
  is_analyzed?: number;
}): Promise<void> {
  const db = await getDb();
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (data.bpm         !== undefined) { sets.push('bpm=?');          vals.push(data.bpm); }
  if (data.bpm_analyzed !== undefined){ sets.push('bpm_analyzed=?'); vals.push(data.bpm_analyzed); }
  if (data.key_camelot !== undefined) { sets.push('key_camelot=?');  vals.push(data.key_camelot); }
  if (data.key_open    !== undefined) { sets.push('key_open=?');     vals.push(data.key_open); }
  if (data.key_musical !== undefined) { sets.push('key_musical=?');  vals.push(data.key_musical); }
  if (data.lufs        !== undefined) { sets.push('lufs=?');         vals.push(data.lufs); }
  if (data.rms_db      !== undefined) { sets.push('rms_db=?');       vals.push(data.rms_db); }
  if (data.peak_db     !== undefined) { sets.push('peak_db=?');      vals.push(data.peak_db); }
  if (data.is_analyzed !== undefined) { sets.push('is_analyzed=?');  vals.push(data.is_analyzed); }
  if (sets.length === 0) return;
  sets.push(`date_modified=datetime('now')`);
  vals.push(id);
  await db.runAsync(`UPDATE tracks SET ${sets.join(',')} WHERE id=?`, vals);
}

export async function deleteTrack(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM tracks WHERE id=?', [id]);
}

export async function getTrackCount(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{n:number}>('SELECT COUNT(*) as n FROM tracks');
  return row?.n ?? 0;
}

// ── Playlist CRUD ──────────────────────────────────────────────────────────────

export async function createPlaylist(title: string, parentId: number | null = null, isFolder = false): Promise<number> {
  const db = await getDb();
  const r = await db.runAsync(
    'INSERT INTO playlists (title, parent_id, is_folder) VALUES (?,?,?)',
    [title, parentId, isFolder ? 1 : 0],
  );
  return r.lastInsertRowId;
}

export async function renamePlaylist(id: number, title: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE playlists SET title=? WHERE id=?', [title, id]);
}

export async function deletePlaylist(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM playlists WHERE id=?', [id]);
}

export async function getAllPlaylists(): Promise<DBPlaylist[]> {
  const db = await getDb();
  return db.getAllAsync<DBPlaylist>(`
    SELECT p.*, (SELECT COUNT(*) FROM playlist_tracks pt WHERE pt.playlist_id=p.id) as track_count
    FROM playlists p ORDER BY p.is_folder DESC, p.title ASC
  `);
}

export async function getPlaylist(id: number): Promise<DBPlaylist | null> {
  const db = await getDb();
  return db.getFirstAsync<DBPlaylist>(
    `SELECT p.*, (SELECT COUNT(*) FROM playlist_tracks pt WHERE pt.playlist_id=p.id) as track_count
     FROM playlists p WHERE p.id=?`,
    [id],
  );
}

export async function markPlaylistSynced(id: number, engineId: number | null = null): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'UPDATE playlists SET synced_at=datetime(\'now\'), engine_id=? WHERE id=?',
    [engineId, id],
  );
}

// ── Playlist-Track relationships ───────────────────────────────────────────────

export async function addTrackToPlaylist(playlistId: number, trackId: number, position?: number): Promise<void> {
  const db = await getDb();
  if (position === undefined) {
    const row = await db.getFirstAsync<{mx:number|null}>(
      'SELECT MAX(position) as mx FROM playlist_tracks WHERE playlist_id=?', [playlistId],
    );
    position = (row?.mx ?? -1) + 1;
  }
  await db.runAsync(
    'INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position) VALUES (?,?,?)',
    [playlistId, trackId, position],
  );
}

export async function removeTrackFromPlaylist(playlistId: number, trackId: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM playlist_tracks WHERE playlist_id=? AND track_id=?', [playlistId, trackId]);
}

export async function getPlaylistTracks(playlistId: number): Promise<DBTrack[]> {
  const db = await getDb();
  return db.getAllAsync<DBTrack>(`
    SELECT t.* FROM tracks t
    JOIN playlist_tracks pt ON pt.track_id = t.id
    WHERE pt.playlist_id=?
    ORDER BY pt.position ASC
  `, [playlistId]);
}

export async function reorderPlaylistTrack(playlistId: number, trackId: number, newPosition: number): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'UPDATE playlist_tracks SET position=? WHERE playlist_id=? AND track_id=?',
    [newPosition, playlistId, trackId],
  );
}

export async function importFolderAsPlaylist(
  folderName: string,
  tracks: Array<{ path: string; filename: string; folder: string; extension: string }>,
): Promise<number> {
  const db = await getDb();
  const plId = await createPlaylist(folderName);
  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i];
    const name = t.filename;
    const title = name.replace(/\.[^.]+$/, '');
    const trackId = await upsertTrack({
      path: t.path, filename: t.filename, folder: t.folder,
      title, artist: '', album: '', genre: '', year: null,
      duration_ms: null, bpm: null, bpm_analyzed: null,
      key_camelot: null, key_open: null, key_musical: null,
      lufs: null, rms_db: null, peak_db: null,
      bitrate: null, file_size: null, file_type: t.extension,
      rating: 0, comment: '', label: '',
      color_r: 0, color_g: 0, color_b: 0, is_analyzed: 0,
      date_added: new Date().toISOString(), date_modified: null,
      engine_id: null, artwork_uri: null,
    });
    await addTrackToPlaylist(plId, trackId, i);
  }
  return plId;
}

// ── Cue Points ─────────────────────────────────────────────────────────────────

export async function upsertCuePoint(c: Omit<DBCuePoint, 'id'|'created_at'>): Promise<number> {
  const db = await getDb();
  const r = await db.runAsync(
    `INSERT INTO cue_points
       (track_id, type, position_ms, length_ms, label, color_r, color_g, color_b, is_hot_cue, hot_cue_number)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [c.track_id, c.type, c.position_ms, c.length_ms, c.label,
     c.color_r, c.color_g, c.color_b, c.is_hot_cue, c.hot_cue_number ?? null],
  );
  return r.lastInsertRowId;
}

export async function getCuePoints(trackId: number): Promise<DBCuePoint[]> {
  const db = await getDb();
  return db.getAllAsync<DBCuePoint>('SELECT * FROM cue_points WHERE track_id=? ORDER BY position_ms', [trackId]);
}

export async function deleteCuePoint(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM cue_points WHERE id=?', [id]);
}

export async function deleteAllCuePoints(trackId: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM cue_points WHERE track_id=?', [trackId]);
}

// ── Saved Loops ────────────────────────────────────────────────────────────────

export async function upsertSavedLoop(l: Omit<DBSavedLoop, 'id'|'created_at'>): Promise<number> {
  const db = await getDb();
  const r = await db.runAsync(
    `INSERT INTO saved_loops (track_id, start_ms, end_ms, label, color_r, color_g, color_b)
     VALUES (?,?,?,?,?,?,?)`,
    [l.track_id, l.start_ms, l.end_ms, l.label, l.color_r, l.color_g, l.color_b],
  );
  return r.lastInsertRowId;
}

export async function getSavedLoops(trackId: number): Promise<DBSavedLoop[]> {
  const db = await getDb();
  return db.getAllAsync<DBSavedLoop>('SELECT * FROM saved_loops WHERE track_id=? ORDER BY start_ms', [trackId]);
}

export async function deleteSavedLoop(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM saved_loops WHERE id=?', [id]);
}

// ── Beatgrid ───────────────────────────────────────────────────────────────────

export async function saveBeatgrid(trackId: number, bpm: number, offsetMs: number, downbeats: number[]): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM beatgrids WHERE track_id=?', [trackId]);
  // Store the main beatgrid entry (bpm + offset) + downbeat markers
  await db.runAsync(
    'INSERT INTO beatgrids (track_id, bpm, offset_ms, is_downbeat, beat_number) VALUES (?,?,?,0,0)',
    [trackId, bpm, offsetMs],
  );
  for (let i = 0; i < downbeats.length; i++) {
    await db.runAsync(
      'INSERT INTO beatgrids (track_id, bpm, offset_ms, is_downbeat, beat_number) VALUES (?,?,?,1,?)',
      [trackId, bpm, downbeats[i], i],
    );
  }
}

export async function getBeatgrid(trackId: number): Promise<DBBeatgrid[]> {
  const db = await getDb();
  return db.getAllAsync<DBBeatgrid>('SELECT * FROM beatgrids WHERE track_id=? ORDER BY offset_ms', [trackId]);
}

// ── Analysis Results ───────────────────────────────────────────────────────────

export async function saveAnalysisResult(r: Omit<DBAnalysisResult, 'id'|'analyzed_at'|'analyzer_ver'>): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO analysis_results
       (track_id, bpm, bpm_confidence, tempo_stability, key_camelot, key_open, key_musical,
        key_confidence, lufs, rms_db, peak_db, waveform_json, beat_grid_json, duration_ms)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(track_id) DO UPDATE SET
       bpm=excluded.bpm, bpm_confidence=excluded.bpm_confidence,
       tempo_stability=excluded.tempo_stability,
       key_camelot=excluded.key_camelot, key_open=excluded.key_open, key_musical=excluded.key_musical,
       key_confidence=excluded.key_confidence,
       lufs=excluded.lufs, rms_db=excluded.rms_db, peak_db=excluded.peak_db,
       waveform_json=excluded.waveform_json, beat_grid_json=excluded.beat_grid_json,
       duration_ms=excluded.duration_ms, analyzed_at=datetime('now')`,
    [r.track_id, r.bpm ?? null, r.bpm_confidence ?? null, r.tempo_stability ?? null,
     r.key_camelot ?? null, r.key_open ?? null, r.key_musical ?? null,
     r.key_confidence ?? null, r.lufs ?? null, r.rms_db ?? null, r.peak_db ?? null,
     r.waveform_json ?? null, r.beat_grid_json ?? null, r.duration_ms ?? null],
  );
  // Mirror key analysis fields back to the tracks table
  await updateTrackAnalysis(r.track_id, {
    bpm: r.bpm, bpm_analyzed: r.bpm,
    key_camelot: r.key_camelot, key_open: r.key_open, key_musical: r.key_musical,
    lufs: r.lufs, rms_db: r.rms_db, peak_db: r.peak_db, is_analyzed: 1,
  });
}

export async function getAnalysisResult(trackId: number): Promise<DBAnalysisResult | null> {
  const db = await getDb();
  return db.getFirstAsync<DBAnalysisResult>('SELECT * FROM analysis_results WHERE track_id=?', [trackId]);
}

// ── Stats ──────────────────────────────────────────────────────────────────────

export interface LibraryStats {
  totalTracks: number;
  analyzedTracks: number;
  totalPlaylists: number;
  avgBpm: number | null;
  avgLufs: number | null;
}

export async function getLibraryStats(): Promise<LibraryStats> {
  const db = await getDb();
  const t = await db.getFirstAsync<{total:number; analyzed:number; avg_bpm:number|null; avg_lufs:number|null}>(
    'SELECT COUNT(*) as total, SUM(is_analyzed) as analyzed, AVG(NULLIF(bpm,0)) as avg_bpm, AVG(lufs) as avg_lufs FROM tracks',
  );
  const p = await db.getFirstAsync<{n:number}>('SELECT COUNT(*) as n FROM playlists WHERE is_folder=0');
  return {
    totalTracks: t?.total ?? 0,
    analyzedTracks: t?.analyzed ?? 0,
    totalPlaylists: p?.n ?? 0,
    avgBpm: t?.avg_bpm ?? null,
    avgLufs: t?.avg_lufs ?? null,
  };
}

// ── Bulk import from AsyncStorage legacy format ────────────────────────────────

export async function migrateFromAsyncStorage(playlists: any[]): Promise<void> {
  for (const pl of playlists) {
    const plId = await createPlaylist(pl.title ?? 'Playlist');
    const tracks: any[] = pl.tracks ?? [];
    for (let i = 0; i < tracks.length; i++) {
      const t = tracks[i];
      const path = t.path ?? '';
      const filename = path.split('/').pop() ?? t.title ?? '';
      const trackId = await upsertTrack({
        path, filename, folder: filename,
        title: t.title ?? filename.replace(/\.[^.]+$/, ''),
        artist: t.artist ?? '', album: '', genre: '', year: null,
        duration_ms: null, bpm: t.bpm ?? null, bpm_analyzed: null,
        key_camelot: t.key ?? null, key_open: null, key_musical: null,
        lufs: null, rms_db: null, peak_db: null,
        bitrate: null, file_size: null, file_type: filename.split('.').pop() ?? '',
        rating: 0, comment: '', label: '',
        color_r: 0, color_g: 0, color_b: 0, is_analyzed: 0,
        date_added: pl.createdAt ?? new Date().toISOString(), date_modified: null,
        engine_id: null, artwork_uri: null,
      });
      await addTrackToPlaylist(plId, trackId, i);
    }
  }
}
