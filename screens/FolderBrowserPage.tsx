import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  FlatList,
  TouchableWithoutFeedback,
  TextInput,
  SafeAreaView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import * as FileSystem from 'expo-file-system';
import * as SQLite from 'expo-sqlite';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Theme } from '../theme/AppTheme';

const STORAGE_KEY = '@dj_engine_selected_card';
const TARGET_TYPE_KEY = '@dj_engine_target_type';
const ENGINE_DB_PATH = 'Engine Library/Database2/m.db';
const PLAYLIST_STORAGE_KEY = '@dj_playlists_v2';

interface StoredTrack {
  id: number; playlistId: number; title: string; artist: string;
  path: string; bpm: number | null; key: string | null; position: number;
}
interface StoredPlaylist {
  id: number; title: string; createdAt: string; synced: boolean; tracks: StoredTrack[];
}

async function loadAllPlaylists(): Promise<StoredPlaylist[]> {
  const raw = await AsyncStorage.getItem(PLAYLIST_STORAGE_KEY);
  if (!raw) return [];
  return JSON.parse(raw) as StoredPlaylist[];
}
async function saveAllPlaylists(playlists: StoredPlaylist[]): Promise<void> {
  await AsyncStorage.setItem(PLAYLIST_STORAGE_KEY, JSON.stringify(playlists));
}
const MUSIC_EXTENSIONS = /\.(mp3|flac|aif|aiff|wav|ogg|m4a|alac)$/i;
const SAF_API = (FileSystem as any).StorageAccessFramework;
const isSafUri = (p: string) => typeof p === 'string' && p.startsWith('content://');

// Extract filename from a SAF child URI (content://...document/VOL:path/to/name)
function getSafEntryName(uri: string): string {
  try {
    const decoded = decodeURIComponent(uri);
    const colonIdx = decoded.lastIndexOf(':');
    if (colonIdx > -1) {
      return decoded.substring(colonIdx + 1).split('/').pop() || '';
    }
    return decoded.split('/').pop() || '';
  } catch {
    return '';
  }
}

async function readMusicFilesSAF(safFolderUri: string): Promise<{ name: string; uri: string }[]> {
  try {
    if (!SAF_API) return [];
    const entries: string[] = await SAF_API.readDirectoryAsync(safFolderUri).catch(() => []);
    const result: { name: string; uri: string }[] = [];
    for (const entry of entries) {
      const name = getSafEntryName(entry);
      if (name && MUSIC_EXTENSIONS.test(name)) {
        result.push({ name, uri: entry });
      }
    }
    return result;
  } catch {
    return [];
  }
}

const CAMELOT_MAP: Record<number, string> = {
  1: '8B', 2: '3B', 3: '10B', 4: '5B', 5: '12B', 6: '7B',
  7: '2B', 8: '9B', 9: '4B', 10: '11B', 11: '6B', 12: '1B',
  13: '8A', 14: '3A', 15: '10A', 16: '5A', 17: '12A', 18: '7A',
  19: '2A', 20: '9A', 21: '4A', 22: '11A', 23: '6A', 24: '1A',
};

const FOLDER_COLORS = [
  '#1DB954', '#F59E0B', '#509BF5', '#B054F5',
  '#E91429', '#F97316', '#06B6D4', '#8B5CF6',
  '#EC4899', '#14B8A6', '#EF4444', '#A3E635',
];

interface Folder {
  id: string;
  name: string;
  tracks: number;
  analysed: number;
  color: string;
  lastModified: string;
  size: string;
  fullPath: string;
}

interface ExistingPlaylist {
  id: number;
  title: string;
  trackCount: number;
}

async function readMusicFiles(folderPath: string): Promise<string[]> {
  try {
    const uri = folderPath.startsWith('file://') ? folderPath : 'file://' + folderPath;
    const files = await FileSystem.readDirectoryAsync(uri);
    return files.filter(f => MUSIC_EXTENSIONS.test(f));
  } catch {
    return [];
  }
}

// Loads BPM + Camelot key from Engine DJ m.db for all analysed tracks
async function loadEngineAnalysis(
  sdPath: string
): Promise<Map<string, { bpm: number | null; key: string | null }>> {
  const map = new Map<string, { bpm: number | null; key: string | null }>();
  try {
    const srcUri = 'file://' + sdPath + '/' + ENGINE_DB_PATH;
    const srcInfo = await FileSystem.getInfoAsync(srcUri);
    if (!srcInfo.exists) return map;

    const sqliteDir = (FileSystem.documentDirectory || '') + 'SQLite/';
    const destUri = sqliteDir + 'm_engine_fb.db';
    await FileSystem.makeDirectoryAsync(sqliteDir, { intermediates: true }).catch(() => {});
    await FileSystem.copyAsync({ from: srcUri, to: destUri });

    let db: SQLite.SQLiteDatabase | null = null;
    try {
      db = await SQLite.openDatabaseAsync('m_engine_fb.db');
    } catch { return map; }

    const parseRow = (filename: string, bpmRaw: any, keyRaw: any) => {
      const name = (filename.split('/').pop() || '').toLowerCase();
      if (!name) return;
      const bpm = bpmRaw != null ? parseFloat(bpmRaw) : null;
      const keyNum = keyRaw != null ? parseInt(keyRaw, 10) : null;
      const key = keyNum != null && CAMELOT_MAP[keyNum] ? CAMELOT_MAP[keyNum] : null;
      map.set(name, { bpm: bpm && bpm > 0 ? bpm : null, key });
    };

    try {
      const rows = await db.getAllAsync<any>(`SELECT filename, bpm, key FROM Track WHERE isAnalysed = 1`);
      for (const r of rows) parseRow(r.filename || '', r.bpm, r.key);
    } catch {
      try {
        const rows = await db.getAllAsync<any>(`SELECT path, bpmAnalyzed, keyAnalyzed FROM Track WHERE isAnalyzed = 1`);
        for (const r of rows) parseRow(r.path || '', r.bpmAnalyzed, r.keyAnalyzed);
      } catch {}
    }
    await db.closeAsync().catch(() => {});
  } catch {}
  return map;
}

// ─── Sub-components ────────────────────────────────────────────────────────────

const FolderRow = ({
  folder,
  delay,
  onLongPress,
}: {
  folder: Folder;
  delay: number;
  onLongPress: (folder: Folder) => void;
}) => {
  const fade = useRef(new Animated.Value(0)).current;
  const translateX = useRef(new Animated.Value(-24)).current;
  const scale = useRef(new Animated.Value(1)).current;
  const pct = folder.tracks > 0 ? Math.round((folder.analysed / folder.tracks) * 100) : 0;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 400, delay, useNativeDriver: true }),
      Animated.spring(translateX, { toValue: 0, delay, useNativeDriver: true }),
    ]).start();
  }, []);

  const handlePressIn = () => Animated.spring(scale, { toValue: 0.97, useNativeDriver: true }).start();
  const handlePressOut = () => Animated.spring(scale, { toValue: 1, useNativeDriver: true }).start();

  return (
    <Animated.View style={{ opacity: fade, transform: [{ translateX }, { scale }] }}>
      <TouchableOpacity
        style={styles.folderRow}
        onLongPress={() => onLongPress(folder)}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        activeOpacity={1}
        delayLongPress={350}
      >
        <View style={[styles.folderIconWrap, { backgroundColor: folder.color + '22' }]}>
          <Ionicons name="folder" size={26} color={folder.color} />
        </View>
        <View style={styles.folderInfo}>
          <View style={styles.folderTopRow}>
            <Text style={styles.folderName} numberOfLines={1}>{folder.name}</Text>
            {folder.size ? <Text style={styles.folderSize}>{folder.size}</Text> : null}
          </View>
          <View style={styles.folderMeta}>
            <Text style={styles.folderMetaText}>{folder.tracks} Tracks</Text>
            {folder.lastModified ? (
              <>
                <Text style={styles.folderMetaDot}>·</Text>
                <Text style={styles.folderMetaText}>{folder.lastModified}</Text>
              </>
            ) : null}
          </View>
          <View style={styles.progressWrap}>
            <View style={styles.progressBar}>
              <View style={[styles.progressFill, { width: `${pct}%` as any, backgroundColor: folder.color }]} />
            </View>
            <Text style={[styles.progressText, { color: folder.color }]}>{pct}%</Text>
          </View>
        </View>
        <Ionicons name="ellipsis-vertical" size={16} color={Theme.colors.textMuted} />
      </TouchableOpacity>
    </Animated.View>
  );
};

const PlaylistPickerRow = ({
  playlist,
  onPress,
}: {
  playlist: ExistingPlaylist;
  onPress: () => void;
}) => (
  <TouchableOpacity style={styles.pickerRow} onPress={onPress} activeOpacity={0.7}>
    <View style={styles.pickerIcon}>
      <Ionicons name="musical-notes" size={18} color={Theme.colors.primary} />
    </View>
    <View style={styles.pickerInfo}>
      <Text style={styles.pickerTitle} numberOfLines={1}>{playlist.title}</Text>
      <Text style={styles.pickerSub}>{playlist.trackCount} Tracks</Text>
    </View>
    <Ionicons name="add-circle-outline" size={22} color={Theme.colors.primary} />
  </TouchableOpacity>
);

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function FolderBrowserPage() {
  const navigation = useNavigation();
  const [search, setSearch] = useState('');
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loading, setLoading] = useState(true);
  const [sdCardPath, setSdCardPath] = useState<string | null>(null);
  const [targetType, setTargetType] = useState<'sd' | 'usb' | null>(null);
  const [selectedFolder, setSelectedFolder] = useState<Folder | null>(null);

  const sheetOpen = useState(false);
  const [sheetVisible, setSheetVisible] = sheetOpen;
  const sheetY = useRef(new Animated.Value(400)).current;
  const overlayOpacity = useRef(new Animated.Value(0)).current;

  const [createSheetOpen, setCreateSheetOpen] = useState(false);
  const [playlistName, setPlaylistName] = useState('');
  const [creating, setCreating] = useState(false);
  const createSheetY = useRef(new Animated.Value(400)).current;
  const createOverlay = useRef(new Animated.Value(0)).current;

  const [addSheetOpen, setAddSheetOpen] = useState(false);
  const [existingPlaylists, setExistingPlaylists] = useState<ExistingPlaylist[]>([]);
  const [loadingPlaylists, setLoadingPlaylists] = useState(false);
  const [adding, setAdding] = useState(false);
  const addSheetY = useRef(new Animated.Value(500)).current;
  const addOverlay = useRef(new Animated.Value(0)).current;

  const headerFade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(headerFade, { toValue: 1, duration: 500, useNativeDriver: true }).start();
    loadFolders();
  }, []);

  const loadFolders = useCallback(async () => {
    setLoading(true);
    try {
      const [storedPath, storedTarget] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEY),
        AsyncStorage.getItem(TARGET_TYPE_KEY),
      ]);
      const tt = (storedTarget === 'usb' || storedTarget === 'sd') ? storedTarget : null;
      setTargetType(tt);
      if (!storedPath) {
        setSdCardPath(null);
        setFolders([]);
        setLoading(false);
        return;
      }
      setSdCardPath(storedPath);

      // ── SAF mode (content:// URI) ───────────────────────────────────────────
      if (isSafUri(storedPath)) {
        if (!SAF_API) { setFolders([]); setLoading(false); return; }
        try {
          // Navigate into Engine Library/Music if available, else use root
          let browseDirUri = storedPath;
          const rootEntries: string[] = await SAF_API.readDirectoryAsync(storedPath).catch(() => []);
          const engLibEntry = rootEntries.find(e => getSafEntryName(e).toLowerCase() === 'engine library');
          if (engLibEntry) {
            const libEntries: string[] = await SAF_API.readDirectoryAsync(engLibEntry).catch(() => []);
            const musicEntry = libEntries.find(e => getSafEntryName(e).toLowerCase() === 'music');
            browseDirUri = musicEntry || engLibEntry;
          }

          const dirEntries: string[] = await SAF_API.readDirectoryAsync(browseDirUri).catch(() => []);
          const folderList: Folder[] = [];
          let idx = 0;
          for (const entry of dirEntries) {
            const name = getSafEntryName(entry);
            if (!name || name.startsWith('.') || MUSIC_EXTENSIONS.test(name)) continue;
            // Check if this is a directory by trying to list it
            const children: string[] | null = await SAF_API.readDirectoryAsync(entry).catch(() => null);
            if (!children) continue;
            const musicFiles = children.filter(e => MUSIC_EXTENSIONS.test(getSafEntryName(e)));
            if (musicFiles.length === 0) continue;
            folderList.push({
              id: String(idx),
              name,
              tracks: musicFiles.length,
              analysed: 0,
              color: FOLDER_COLORS[idx % FOLDER_COLORS.length],
              lastModified: '',
              size: '',
              fullPath: entry, // SAF URI of the subfolder
            });
            idx++;
          }
          setFolders(folderList);
        } catch {
          setFolders([]);
        }
        setLoading(false);
        return;
      }

      // ── Regular file:// mode ────────────────────────────────────────────────
      // Try Engine Library/Music first, then root
      const musicPath = storedPath + '/Engine Library/Music';
      const musicUri = 'file://' + musicPath;
      let basePath = storedPath;

      const musicInfo = await FileSystem.getInfoAsync(musicUri).catch(() => ({ exists: false }));
      if (musicInfo.exists) {
        basePath = musicPath;
      }

      const baseUri = 'file://' + basePath;
      const entries = await FileSystem.readDirectoryAsync(baseUri).catch(() => []);

      // Filter to directories that contain music files
      const folderList: Folder[] = [];
      const folderFilesList: string[][] = [];
      for (let i = 0; i < entries.length; i++) {
        const name = entries[i];
        if (name.startsWith('.')) continue;

        const entryPath = basePath + '/' + name;
        const entryUri = 'file://' + entryPath;
        const info = await FileSystem.getInfoAsync(entryUri).catch(() => ({ exists: false, isDirectory: false }));

        if (!info.exists) continue;

        const isDir = (info as any).isDirectory === true;
        if (!isDir) continue;

        const musicFiles = await readMusicFiles(entryPath);
        if (musicFiles.length === 0) continue;

        folderList.push({
          id: String(i),
          name,
          tracks: musicFiles.length,
          analysed: 0,
          color: FOLDER_COLORS[i % FOLDER_COLORS.length],
          lastModified: '',
          size: '',
          fullPath: entryPath,
        });
        folderFilesList.push(musicFiles);
      }

      // Enrich analysed counts from Engine DJ database
      const engineMap = await loadEngineAnalysis(storedPath);
      if (engineMap.size > 0) {
        folderList.forEach((folder, idx) => {
          folder.analysed = folderFilesList[idx].filter(fn => engineMap.has(fn.toLowerCase())).length;
        });
      }

      setFolders(folderList);
    } catch {
      setFolders([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // --- Context sheet ---
  const openSheet = (folder: Folder) => {
    setSelectedFolder(folder);
    setSheetVisible(true);
    Animated.parallel([
      Animated.spring(sheetY, { toValue: 0, useNativeDriver: true }),
      Animated.timing(overlayOpacity, { toValue: 1, duration: 250, useNativeDriver: true }),
    ]).start();
  };

  const closeSheet = (cb?: () => void) => {
    Animated.parallel([
      Animated.timing(sheetY, { toValue: 400, duration: 220, useNativeDriver: true }),
      Animated.timing(overlayOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(() => {
      setSheetVisible(false);
      cb?.();
    });
  };

  // --- Create playlist sheet ---
  const openCreateSheet = () => {
    closeSheet(() => {
      setPlaylistName(selectedFolder?.name ?? '');
      setCreateSheetOpen(true);
      Animated.parallel([
        Animated.spring(createSheetY, { toValue: 0, useNativeDriver: true }),
        Animated.timing(createOverlay, { toValue: 1, duration: 250, useNativeDriver: true }),
      ]).start();
    });
  };

  const closeCreateSheet = () => {
    Animated.parallel([
      Animated.timing(createSheetY, { toValue: 400, duration: 220, useNativeDriver: true }),
      Animated.timing(createOverlay, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(() => {
      setCreateSheetOpen(false);
      setPlaylistName('');
      setSelectedFolder(null);
    });
  };

  const handleCreatePlaylist = async () => {
    const name = playlistName.trim();
    if (!name || !selectedFolder) return;
    setCreating(true);
    try {
      const useSaf = isSafUri(selectedFolder.fullPath);
      const analysisMap = (!useSaf && sdCardPath) ? await loadEngineAnalysis(sdCardPath) : new Map<string, any>();

      let newTracks: StoredTrack[] = [];
      const all = await loadAllPlaylists();
      const newId = all.length === 0 ? 1 : Math.max(...all.map(p => p.id)) + 1;

      if (useSaf) {
        const safFiles = await readMusicFilesSAF(selectedFolder.fullPath);
        newTracks = safFiles.map(({ name: filename, uri }, i) => ({
          id: i + 1,
          playlistId: newId,
          title: filename.replace(/\.[^/.]+$/, ''),
          artist: '',
          path: uri,
          bpm: null,
          key: null,
          position: i,
        }));
      } else {
        const files = await readMusicFiles(selectedFolder.fullPath);
        newTracks = files.map((filename, i) => {
          const analysis = analysisMap.get(filename.toLowerCase());
          return {
            id: i + 1,
            playlistId: newId,
            title: filename.replace(/\.[^/.]+$/, ''),
            artist: '',
            path: selectedFolder.fullPath + '/' + filename,
            bpm: analysis?.bpm ?? null,
            key: analysis?.key ?? null,
            position: i,
          };
        });
      }

      const newPlaylist: StoredPlaylist = {
        id: newId,
        title: name,
        createdAt: new Date().toISOString(),
        synced: false,
        tracks: newTracks,
      };
      await saveAllPlaylists([newPlaylist, ...all]);
      closeCreateSheet();
      Alert.alert('Playlist erstellt', `"${name}" wurde mit ${newTracks.length} Tracks erstellt.`);
    } catch {
      Alert.alert('Fehler', 'Playlist konnte nicht erstellt werden.');
    } finally {
      setCreating(false);
    }
  };

  // --- Add-to-playlist sheet ---
  const openAddSheet = async () => {
    closeSheet(async () => {
      setLoadingPlaylists(true);
      setAddSheetOpen(true);
      Animated.parallel([
        Animated.spring(addSheetY, { toValue: 0, useNativeDriver: true }),
        Animated.timing(addOverlay, { toValue: 1, duration: 250, useNativeDriver: true }),
      ]).start();
      try {
        const all = await loadAllPlaylists();
        setExistingPlaylists(all.map(p => ({ id: p.id, title: p.title, trackCount: p.tracks.length })));
      } catch {
        setExistingPlaylists([]);
      } finally {
        setLoadingPlaylists(false);
      }
    });
  };

  const closeAddSheet = () => {
    Animated.parallel([
      Animated.timing(addSheetY, { toValue: 500, duration: 220, useNativeDriver: true }),
      Animated.timing(addOverlay, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(() => {
      setAddSheetOpen(false);
      setExistingPlaylists([]);
      setSelectedFolder(null);
    });
  };

  const handleAddToPlaylist = async (playlist: ExistingPlaylist) => {
    if (!selectedFolder) return;
    setAdding(true);
    try {
      const useSaf = isSafUri(selectedFolder.fullPath);
      const analysisMap = (!useSaf && sdCardPath) ? await loadEngineAnalysis(sdCardPath) : new Map<string, any>();

      const all = await loadAllPlaylists();
      const found = all.find(p => p.id === playlist.id);
      if (!found) throw new Error('Playlist nicht gefunden');
      const maxPos = found.tracks.length > 0 ? Math.max(...found.tracks.map(t => t.position)) + 1 : 0;
      const maxId = found.tracks.length > 0 ? Math.max(...found.tracks.map(t => t.id)) + 1 : 1;

      let newTracks: StoredTrack[] = [];
      if (useSaf) {
        const safFiles = await readMusicFilesSAF(selectedFolder.fullPath);
        newTracks = safFiles.map(({ name: filename, uri }, i) => ({
          id: maxId + i,
          playlistId: playlist.id,
          title: filename.replace(/\.[^/.]+$/, ''),
          artist: '',
          path: uri,
          bpm: null,
          key: null,
          position: maxPos + i,
        }));
      } else {
        const files = await readMusicFiles(selectedFolder.fullPath);
        newTracks = files.map((filename, i) => {
          const analysis = analysisMap.get(filename.toLowerCase());
          return {
            id: maxId + i,
            playlistId: playlist.id,
            title: filename.replace(/\.[^/.]+$/, ''),
            artist: '',
            path: selectedFolder.fullPath + '/' + filename,
            bpm: analysis?.bpm ?? null,
            key: analysis?.key ?? null,
            position: maxPos + i,
          };
        });
      }

      const updated = all.map(p =>
        p.id === playlist.id ? { ...p, synced: false, tracks: [...p.tracks, ...newTracks] } : p
      );
      await saveAllPlaylists(updated);
      closeAddSheet();
      Alert.alert(
        'Tracks hinzugefügt',
        `${newTracks.length} Tracks aus "${selectedFolder.name}" wurden zu "${playlist.title}" hinzugefügt.`
      );
    } catch {
      Alert.alert('Fehler', 'Tracks konnten nicht hinzugefügt werden.');
    } finally {
      setAdding(false);
    }
  };

  const filtered = folders.filter(f =>
    f.name.toLowerCase().includes(search.toLowerCase())
  );

  const totalTracks = folders.reduce((s, f) => s + f.tracks, 0);
  const totalAnalysed = folders.reduce((s, f) => s + f.analysed, 0);

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Header */}
      <Animated.View style={[styles.header, { opacity: headerFade }]}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={22} color={Theme.colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Ordner</Text>
        <TouchableOpacity style={styles.refreshBtn} onPress={loadFolders} disabled={loading}>
          {loading ? (
            <ActivityIndicator size="small" color={Theme.colors.primary} />
          ) : (
            <Ionicons name="refresh" size={20} color={Theme.colors.primary} />
          )}
        </TouchableOpacity>
        <View style={styles.headerBadge}>
          <Text style={styles.headerBadgeText}>{folders.length}</Text>
        </View>
      </Animated.View>

      {/* Search */}
      <Animated.View style={[styles.searchWrap, { opacity: headerFade }]}>
        <Ionicons name="search" size={18} color={Theme.colors.textMuted} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Ordner suchen..."
          placeholderTextColor={Theme.colors.placeholder}
          value={search}
          onChangeText={setSearch}
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')}>
            <Ionicons name="close-circle" size={18} color={Theme.colors.textMuted} />
          </TouchableOpacity>
        )}
      </Animated.View>

      {/* Summary Bar */}
      {folders.length > 0 && (
        <Animated.View style={[styles.summaryBar, { opacity: headerFade }]}>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryValue}>{totalTracks.toLocaleString()}</Text>
            <Text style={styles.summaryLabel}>Tracks</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <Text style={styles.summaryValue}>{folders.length}</Text>
            <Text style={styles.summaryLabel}>Ordner</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryValue, { color: targetType === 'usb' ? '#F59E0B' : Theme.colors.primary }]}>
              {sdCardPath ? '✓' : '–'}
            </Text>
            <Text style={styles.summaryLabel}>{targetType === 'usb' ? 'USB-Stick' : 'SD-Karte'}</Text>
          </View>
        </Animated.View>
      )}

      {/* Path hint */}
      {sdCardPath && (
        <Animated.View style={[styles.pathHint, { opacity: headerFade }]}>
          <Ionicons
            name={targetType === 'usb' ? 'logo-usb' : 'hardware-chip-outline'}
            size={13}
            color={targetType === 'usb' ? '#F59E0B' : Theme.colors.primary}
          />
          <Text
            style={[styles.pathHintText, targetType === 'usb' && { color: '#F59E0B' }]}
            numberOfLines={1}
          >
            {sdCardPath.length > 40 ? '…' + sdCardPath.slice(-38) : sdCardPath}
          </Text>
        </Animated.View>
      )}

      {/* Folder List */}
      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={Theme.colors.primary} />
          <Text style={styles.loadingText}>Ordner werden geladen…</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={item => item.id}
          renderItem={({ item, index }) => (
            <FolderRow folder={item} delay={index * 60} onLongPress={openSheet} />
          )}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Ionicons name="folder-open-outline" size={56} color={Theme.colors.textMuted} />
              <Text style={styles.emptyTitle}>
                {sdCardPath
                  ? 'Keine Musikordner gefunden'
                  : targetType === 'usb' ? 'Kein USB-Stick verbunden' : 'Keine SD-Karte verbunden'}
              </Text>
              <Text style={styles.emptySubtitle}>
                {sdCardPath
                  ? `${targetType === 'usb' ? 'Der USB-Stick' : 'Die SD-Karte'} enthält keine lesbaren Musikordner`
                  : `Gehe zu "${targetType === 'usb' ? 'USB-Stick' : 'SD-Karte'} öffnen" und wähle dein Speichermedium aus`}
              </Text>
              {!sdCardPath && (
                <TouchableOpacity
                  style={[styles.emptyAction, targetType === 'usb' && { backgroundColor: '#F59E0B' }]}
                  onPress={() => (navigation as any).navigate('SDCardSelector')}
                >
                  <Text style={styles.emptyActionText}>
                    {targetType === 'usb' ? 'USB-Stick auswählen' : 'SD-Karte auswählen'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          }
        />
      )}

      {/* Long-Press Context Sheet */}
      {sheetVisible && (
        <View style={StyleSheet.absoluteFill}>
          <TouchableWithoutFeedback onPress={() => closeSheet()}>
            <Animated.View style={[StyleSheet.absoluteFill, styles.overlay, { opacity: overlayOpacity }]} />
          </TouchableWithoutFeedback>
          <Animated.View style={[styles.sheet, { transform: [{ translateY: sheetY }] }]}>
            <View style={styles.sheetHandle} />
            {selectedFolder && (
              <>
                <View style={styles.sheetFolderHeader}>
                  <View style={[styles.sheetFolderIcon, { backgroundColor: selectedFolder.color + '22' }]}>
                    <Ionicons name="folder" size={24} color={selectedFolder.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.sheetFolderName} numberOfLines={1}>{selectedFolder.name}</Text>
                    <Text style={styles.sheetFolderMeta}>{selectedFolder.tracks} Tracks</Text>
                  </View>
                </View>
                <View style={styles.sheetDivider} />

                <TouchableOpacity style={styles.sheetAction} onPress={openCreateSheet}>
                  <View style={[styles.sheetActionIcon, { backgroundColor: Theme.colors.primary + '18' }]}>
                    <Ionicons name="add-circle-outline" size={20} color={Theme.colors.primary} />
                  </View>
                  <Text style={styles.sheetActionLabel}>Als Playlist erstellen</Text>
                  <Ionicons name="chevron-forward" size={16} color={Theme.colors.textMuted} />
                </TouchableOpacity>

                <TouchableOpacity style={styles.sheetAction} onPress={openAddSheet}>
                  <View style={[styles.sheetActionIcon, { backgroundColor: '#509BF518' }]}>
                    <Ionicons name="list-outline" size={20} color="#509BF5" />
                  </View>
                  <Text style={styles.sheetActionLabel}>Zur Playlist hinzufügen</Text>
                  <Ionicons name="chevron-forward" size={16} color={Theme.colors.textMuted} />
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.sheetAction}
                  onPress={() => closeSheet(() => (navigation as any).navigate('AnalysisProgress'))}
                >
                  <View style={[styles.sheetActionIcon, { backgroundColor: '#F59E0B18' }]}>
                    <Ionicons name="pulse-outline" size={20} color="#F59E0B" />
                  </View>
                  <Text style={styles.sheetActionLabel}>Ordner analysieren</Text>
                  <Ionicons name="chevron-forward" size={16} color={Theme.colors.textMuted} />
                </TouchableOpacity>

                <TouchableOpacity style={styles.sheetCancelBtn} onPress={() => closeSheet()}>
                  <Text style={styles.sheetCancelText}>Abbrechen</Text>
                </TouchableOpacity>
              </>
            )}
          </Animated.View>
        </View>
      )}

      {/* Create Playlist Sheet */}
      {createSheetOpen && (
        <View style={StyleSheet.absoluteFill}>
          <TouchableWithoutFeedback onPress={closeCreateSheet}>
            <Animated.View style={[StyleSheet.absoluteFill, styles.overlay, { opacity: createOverlay }]} />
          </TouchableWithoutFeedback>
          <Animated.View style={[styles.sheet, styles.createSheet, { transform: [{ translateY: createSheetY }] }]}>
            <View style={styles.sheetHandle} />
            <Text style={styles.subSheetTitle}>Neue Playlist</Text>
            {selectedFolder && (
              <Text style={styles.subSheetSub}>
                {selectedFolder.tracks} Tracks aus "{selectedFolder.name}"
              </Text>
            )}
            <TextInput
              style={styles.nameInput}
              placeholder="Playlist-Name..."
              placeholderTextColor={Theme.colors.placeholder}
              value={playlistName}
              onChangeText={setPlaylistName}
              autoFocus
              maxLength={60}
            />
            <TouchableOpacity
              style={[styles.confirmBtn, (!playlistName.trim() || creating) && styles.confirmBtnDisabled]}
              onPress={handleCreatePlaylist}
              disabled={!playlistName.trim() || creating}
            >
              {creating ? (
                <ActivityIndicator size="small" color={Theme.colors.black} />
              ) : (
                <Text style={styles.confirmBtnText}>Erstellen</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelTextBtn} onPress={closeCreateSheet}>
              <Text style={styles.cancelText}>Abbrechen</Text>
            </TouchableOpacity>
          </Animated.View>
        </View>
      )}

      {/* Add to Playlist Sheet */}
      {addSheetOpen && (
        <View style={StyleSheet.absoluteFill}>
          <TouchableWithoutFeedback onPress={closeAddSheet}>
            <Animated.View style={[StyleSheet.absoluteFill, styles.overlay, { opacity: addOverlay }]} />
          </TouchableWithoutFeedback>
          <Animated.View style={[styles.sheet, styles.addSheet, { transform: [{ translateY: addSheetY }] }]}>
            <View style={styles.sheetHandle} />
            <Text style={styles.subSheetTitle}>Zur Playlist hinzufügen</Text>
            {selectedFolder && (
              <Text style={styles.subSheetSub}>
                {selectedFolder.tracks} Tracks aus "{selectedFolder.name}"
              </Text>
            )}
            <View style={styles.sheetDivider} />
            {loadingPlaylists ? (
              <View style={styles.pickerLoading}>
                <ActivityIndicator size="small" color={Theme.colors.primary} />
                <Text style={styles.pickerLoadingText}>Playlists laden...</Text>
              </View>
            ) : existingPlaylists.length === 0 ? (
              <View style={styles.pickerEmpty}>
                <Ionicons name="musical-notes-outline" size={40} color={Theme.colors.textMuted} />
                <Text style={styles.pickerEmptyText}>Keine Playlists vorhanden</Text>
                <Text style={styles.pickerEmptyHint}>Erstelle zuerst eine Playlist</Text>
              </View>
            ) : (
              <FlatList
                data={existingPlaylists}
                keyExtractor={item => String(item.id)}
                renderItem={({ item }) => (
                  <PlaylistPickerRow
                    playlist={item}
                    onPress={() => handleAddToPlaylist(item)}
                  />
                )}
                style={styles.pickerList}
                showsVerticalScrollIndicator={false}
                ItemSeparatorComponent={() => <View style={styles.pickerSeparator} />}
              />
            )}
            {adding && (
              <View style={styles.addingOverlay}>
                <ActivityIndicator size="large" color={Theme.colors.primary} />
                <Text style={styles.addingText}>Tracks werden hinzugefügt...</Text>
              </View>
            )}
            <TouchableOpacity style={styles.cancelTextBtn} onPress={closeAddSheet}>
              <Text style={styles.cancelText}>Abbrechen</Text>
            </TouchableOpacity>
          </Animated.View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Theme.colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.lg,
    paddingTop: Theme.spacing.md,
    paddingBottom: Theme.spacing.sm,
    gap: Theme.spacing.sm,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: Theme.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    fontSize: Theme.typography.fontSize.xxl,
    fontWeight: Theme.typography.fontWeight.bold as any,
    color: Theme.colors.text,
  },
  refreshBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: Theme.colors.primary + '15',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerBadge: {
    backgroundColor: Theme.colors.primary + '25',
    borderRadius: Theme.borderRadius.full,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: Theme.colors.primary + '40',
  },
  headerBadgeText: {
    fontSize: Theme.typography.fontSize.sm,
    fontWeight: Theme.typography.fontWeight.semibold as any,
    color: Theme.colors.primary,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: Theme.spacing.lg,
    marginBottom: Theme.spacing.sm,
    backgroundColor: Theme.colors.surface,
    borderRadius: Theme.borderRadius.md,
    paddingHorizontal: Theme.spacing.md,
    height: 44,
    borderWidth: 1,
    borderColor: Theme.colors.border,
  },
  searchIcon: {
    marginRight: Theme.spacing.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: Theme.typography.fontSize.md,
    color: Theme.colors.text,
  },
  summaryBar: {
    flexDirection: 'row',
    marginHorizontal: Theme.spacing.lg,
    marginBottom: Theme.spacing.sm,
    backgroundColor: Theme.colors.card,
    borderRadius: Theme.borderRadius.md,
    padding: Theme.spacing.md,
    ...Theme.elevation.sm,
    borderWidth: 1,
    borderColor: Theme.colors.border,
  },
  summaryItem: {
    flex: 1,
    alignItems: 'center',
  },
  summaryValue: {
    fontSize: Theme.typography.fontSize.lg,
    fontWeight: Theme.typography.fontWeight.bold as any,
    color: Theme.colors.text,
  },
  summaryLabel: {
    fontSize: Theme.typography.fontSize.xs,
    color: Theme.colors.textMuted,
    marginTop: 2,
  },
  summaryDivider: {
    width: 1,
    height: '100%',
    backgroundColor: Theme.colors.divider,
  },
  pathHint: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: Theme.spacing.lg,
    marginBottom: Theme.spacing.sm,
    gap: 5,
  },
  pathHintText: {
    fontSize: 11,
    color: Theme.colors.primary,
    fontFamily: 'monospace' as any,
    flex: 1,
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
  },
  loadingText: {
    fontSize: Theme.typography.fontSize.sm,
    color: Theme.colors.textMuted,
  },
  listContent: {
    paddingHorizontal: Theme.spacing.lg,
    paddingBottom: 20,
    gap: Theme.spacing.sm,
  },
  folderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Theme.colors.card,
    borderRadius: Theme.borderRadius.lg,
    padding: Theme.spacing.md,
    gap: Theme.spacing.md,
    ...Theme.elevation.sm,
    borderWidth: 1,
    borderColor: Theme.colors.border,
  },
  folderIconWrap: {
    width: 52,
    height: 52,
    borderRadius: Theme.borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  folderInfo: {
    flex: 1,
    gap: 4,
  },
  folderTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  folderName: {
    flex: 1,
    fontSize: Theme.typography.fontSize.md,
    fontWeight: Theme.typography.fontWeight.semibold as any,
    color: Theme.colors.text,
  },
  folderSize: {
    fontSize: Theme.typography.fontSize.xs,
    color: Theme.colors.textMuted,
  },
  folderMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  folderMetaText: {
    fontSize: Theme.typography.fontSize.xs,
    color: Theme.colors.textSecondary,
  },
  folderMetaDot: {
    fontSize: Theme.typography.fontSize.xs,
    color: Theme.colors.textMuted,
  },
  progressWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  progressBar: {
    flex: 1,
    height: 3,
    backgroundColor: Theme.colors.surface,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
  },
  progressText: {
    fontSize: Theme.typography.fontSize.xs,
    fontWeight: Theme.typography.fontWeight.semibold as any,
    minWidth: 30,
    textAlign: 'right',
  },
  emptyState: {
    alignItems: 'center',
    paddingTop: 80,
    gap: 12,
    paddingHorizontal: Theme.spacing.lg,
  },
  emptyTitle: {
    fontSize: Theme.typography.fontSize.lg,
    fontWeight: Theme.typography.fontWeight.semibold as any,
    color: Theme.colors.textSecondary,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: Theme.typography.fontSize.sm,
    color: Theme.colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
  emptyAction: {
    marginTop: 8,
    backgroundColor: Theme.colors.primary,
    borderRadius: Theme.borderRadius.md,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  emptyActionText: {
    fontSize: Theme.typography.fontSize.md,
    fontWeight: Theme.typography.fontWeight.semibold as any,
    color: '#000',
  },
  overlay: {
    backgroundColor: 'rgba(0,0,0,0.65)',
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: Theme.colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 12,
    paddingBottom: 36,
    ...Theme.elevation.xl,
  },
  createSheet: {
    paddingHorizontal: 20,
  },
  addSheet: {
    paddingHorizontal: 0,
    maxHeight: '75%',
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Theme.colors.disabled,
    alignSelf: 'center',
    marginBottom: 16,
  },
  sheetFolderHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 12,
    gap: 12,
  },
  sheetFolderIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetFolderName: {
    fontSize: Theme.typography.fontSize.lg,
    fontWeight: Theme.typography.fontWeight.bold as any,
    color: Theme.colors.text,
  },
  sheetFolderMeta: {
    fontSize: Theme.typography.fontSize.sm,
    color: Theme.colors.textMuted,
  },
  sheetDivider: {
    height: 1,
    backgroundColor: Theme.colors.divider,
    marginBottom: 8,
  },
  sheetAction: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 14,
  },
  sheetActionIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetActionLabel: {
    flex: 1,
    fontSize: Theme.typography.fontSize.md,
    fontWeight: Theme.typography.fontWeight.medium as any,
    color: Theme.colors.text,
  },
  sheetCancelBtn: {
    marginHorizontal: 20,
    marginTop: 8,
    paddingVertical: 14,
    borderRadius: Theme.borderRadius.md,
    backgroundColor: Theme.colors.card,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Theme.colors.border,
  },
  sheetCancelText: {
    fontSize: Theme.typography.fontSize.md,
    fontWeight: Theme.typography.fontWeight.semibold as any,
    color: Theme.colors.textSecondary,
  },
  subSheetTitle: {
    fontSize: Theme.typography.fontSize.xxl,
    fontWeight: Theme.typography.fontWeight.bold as any,
    color: Theme.colors.text,
    marginBottom: 4,
  },
  subSheetSub: {
    fontSize: Theme.typography.fontSize.sm,
    color: Theme.colors.textSecondary,
    marginBottom: Theme.spacing.lg,
  },
  nameInput: {
    backgroundColor: Theme.colors.card,
    borderRadius: Theme.borderRadius.md,
    padding: Theme.spacing.md,
    fontSize: Theme.typography.fontSize.md,
    color: Theme.colors.text,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    marginBottom: Theme.spacing.lg,
  },
  confirmBtn: {
    backgroundColor: Theme.colors.primary,
    borderRadius: Theme.borderRadius.md,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: Theme.spacing.sm,
  },
  confirmBtnDisabled: {
    opacity: 0.4,
  },
  confirmBtnText: {
    fontSize: Theme.typography.fontSize.md,
    fontWeight: Theme.typography.fontWeight.semibold as any,
    color: Theme.colors.black,
  },
  cancelTextBtn: {
    paddingVertical: 12,
    alignItems: 'center',
    marginHorizontal: 20,
  },
  cancelText: {
    fontSize: Theme.typography.fontSize.md,
    color: Theme.colors.textSecondary,
  },
  pickerList: {
    paddingHorizontal: 20,
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 12,
  },
  pickerIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: 'rgba(29,185,84,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerInfo: {
    flex: 1,
  },
  pickerTitle: {
    fontSize: Theme.typography.fontSize.md,
    fontWeight: Theme.typography.fontWeight.medium as any,
    color: Theme.colors.text,
  },
  pickerSub: {
    fontSize: Theme.typography.fontSize.xs,
    color: Theme.colors.textSecondary,
    marginTop: 2,
  },
  pickerSeparator: {
    height: 1,
    backgroundColor: Theme.colors.divider,
  },
  pickerLoading: {
    paddingVertical: 40,
    alignItems: 'center',
    gap: 12,
  },
  pickerLoadingText: {
    fontSize: Theme.typography.fontSize.sm,
    color: Theme.colors.textSecondary,
  },
  pickerEmpty: {
    paddingVertical: 40,
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
  },
  pickerEmptyText: {
    fontSize: Theme.typography.fontSize.md,
    fontWeight: Theme.typography.fontWeight.semibold as any,
    color: Theme.colors.textSecondary,
    marginTop: 8,
  },
  pickerEmptyHint: {
    fontSize: Theme.typography.fontSize.sm,
    color: Theme.colors.textMuted,
    textAlign: 'center',
  },
  addingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  addingText: {
    fontSize: Theme.typography.fontSize.md,
    color: Theme.colors.text,
    fontWeight: Theme.typography.fontWeight.medium as any,
  },
});
