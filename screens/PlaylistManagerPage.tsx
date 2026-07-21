import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  TextInput,
  Alert,
  Animated,
  ScrollView,
  ActivityIndicator,
  SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Theme } from '../theme/AppTheme';

const STORAGE_KEY = '@dj_playlists_v2';

const USB_CANDIDATES: { path: string; label: string }[] = [
  { path: '/storage/usb0',          label: 'USB-Stick (usb0)'   },
  { path: '/storage/usb1',          label: 'USB-Stick (usb1)'   },
  { path: '/storage/usbdisk',       label: 'USB-Stick'           },
  { path: '/storage/UsbDriveA',     label: 'USB-Stick A'         },
  { path: '/storage/UsbDriveB',     label: 'USB-Stick B'         },
  { path: '/mnt/usb_storage',       label: 'USB-Speicher'        },
  { path: '/mnt/usb',               label: 'USB (mnt)'           },
  { path: '/mnt/media_rw/usb0',     label: 'USB (usb0/rw)'      },
  { path: '/mnt/media_rw/usb1',     label: 'USB (usb1/rw)'      },
  { path: '/mnt/media_rw/udisk0',   label: 'USB-Disk 0'          },
  { path: '/mnt/media_rw/udisk1',   label: 'USB-Disk 1'          },
  { path: '/storage/sdcard1',       label: 'SD-Karte (sdcard1)'  },
  { path: '/storage/extSdCard',     label: 'SD-Karte (ext)'      },
  { path: '/storage/external_sd',   label: 'SD-Karte (extern)'   },
];

interface ExportTarget {
  path: string;
  label: string;
  hasEngineLibrary: boolean;
}

interface PlaylistManagerPageProps {
  navigation: any;
}

interface Track {
  id: number;
  playlistId: number;
  title: string;
  artist: string;
  path: string;
  bpm: number | null;
  key: string | null;
  position: number;
}

interface Playlist {
  id: number;
  title: string;
  createdAt: string;
  synced: boolean;
  tracks: Track[];
}

interface PlaylistDisplay {
  id: number;
  title: string;
  trackCount: number;
  createdAt: string;
  synced: boolean;
}

// Convert a SAF content:// document URI to a real filesystem path
// e.g. content://...document/primary:Music/song.mp3 → /storage/emulated/0/Music/song.mp3
//      content://...document/1A2B-3C4D:Music/song.mp3 → /storage/1A2B-3C4D/Music/song.mp3
function safUriToFilePath(uri: string): string {
  try {
    const decoded = decodeURIComponent(uri);
    const docMatch = decoded.match(/\/document\/(.+)$/);
    if (!docMatch) return uri;
    const docId = docMatch[1];
    const colonIdx = docId.indexOf(':');
    if (colonIdx < 0) return uri;
    const volume = docId.substring(0, colonIdx);
    const relPath = docId.substring(colonIdx + 1);
    if (volume === 'primary') return '/storage/emulated/0/' + relPath;
    return '/storage/' + volume + '/' + relPath;
  } catch {
    return uri;
  }
}

// --- AsyncStorage helpers ---

async function loadAllPlaylists(): Promise<Playlist[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  return JSON.parse(raw) as Playlist[];
}

async function saveAllPlaylists(playlists: Playlist[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(playlists));
}

function nextId(playlists: Playlist[]): number {
  if (playlists.length === 0) return 1;
  return Math.max(...playlists.map((p) => p.id)) + 1;
}

// --- Component ---

const PlaylistManagerPage: React.FC<PlaylistManagerPageProps> = ({ navigation }) => {
  const [playlists, setPlaylists] = useState<PlaylistDisplay[]>([]);
  const [selectedPlaylist, setSelectedPlaylist] = useState<PlaylistDisplay | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [showCreateSheet, setShowCreateSheet] = useState(false);
  const [showEditSheet, setShowEditSheet] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [editName, setEditName] = useState('');
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState('');
  const [sdCardPath, setSdCardPath] = useState<string | null>(null);
  const [targetType, setTargetType] = useState<'sd' | 'usb'>('sd');
  const [view, setView] = useState<'list' | 'detail'>('list');
  const [showTargetSheet, setShowTargetSheet] = useState(false);
  const [targetPlaylist, setTargetPlaylist] = useState<PlaylistDisplay | null>(null);
  const [exportTargets, setExportTargets] = useState<ExportTarget[]>([]);
  const [scanningUsb, setScanningUsb] = useState(false);

  const sheetAnim = useRef(new Animated.Value(0)).current;
  const targetSheetAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    initData();
    loadSdCardPath();
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: Theme.animation.normal,
      useNativeDriver: true,
    }).start();
  }, []);

  const initData = async () => {
    try {
      await refreshPlaylists();
    } catch (e) {
      Alert.alert('Fehler', 'Playlists konnten nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  };

  const refreshPlaylists = async () => {
    const all = await loadAllPlaylists();
    setPlaylists(
      all.map((p) => ({
        id: p.id,
        title: p.title,
        trackCount: p.tracks.length,
        createdAt: p.createdAt,
        synced: p.synced,
      }))
    );
  };

  const loadSdCardPath = async () => {
    const [path, type] = await Promise.all([
      AsyncStorage.getItem('@dj_engine_selected_card'),
      AsyncStorage.getItem('@dj_engine_target_type'),
    ]);
    setSdCardPath(path);
    setTargetType((type as 'sd' | 'usb') || 'sd');
  };

  const openSheet = (type: 'create' | 'edit') => {
    if (type === 'create') setShowCreateSheet(true);
    else setShowEditSheet(true);
    Animated.spring(sheetAnim, {
      toValue: 1,
      tension: 65,
      friction: 11,
      useNativeDriver: true,
    }).start();
  };

  const closeSheet = () => {
    Animated.timing(sheetAnim, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      setShowCreateSheet(false);
      setShowEditSheet(false);
      setNewPlaylistName('');
      setEditName('');
    });
  };

  const createPlaylist = async () => {
    const name = newPlaylistName.trim();
    if (!name) return;
    const all = await loadAllPlaylists();
    const newPlaylist: Playlist = {
      id: nextId(all),
      title: name,
      createdAt: new Date().toISOString(),
      synced: false,
      tracks: [],
    };
    await saveAllPlaylists([newPlaylist, ...all]);
    await refreshPlaylists();
    closeSheet();
  };

  const renamePlaylist = async () => {
    if (!selectedPlaylist || !editName.trim()) return;
    const all = await loadAllPlaylists();
    const updated = all.map((p) =>
      p.id === selectedPlaylist.id ? { ...p, title: editName.trim(), synced: false } : p
    );
    await saveAllPlaylists(updated);
    setSelectedPlaylist({ ...selectedPlaylist, title: editName.trim(), synced: false });
    await refreshPlaylists();
    closeSheet();
  };

  const deletePlaylist = (playlist: PlaylistDisplay) => {
    Alert.alert(
      'Playlist löschen',
      `"${playlist.title}" wirklich löschen?`,
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Löschen',
          style: 'destructive',
          onPress: async () => {
            const all = await loadAllPlaylists();
            await saveAllPlaylists(all.filter((p) => p.id !== playlist.id));
            if (selectedPlaylist?.id === playlist.id) {
              setView('list');
              setSelectedPlaylist(null);
            }
            await refreshPlaylists();
          },
        },
      ]
    );
  };

  const openPlaylist = async (playlist: PlaylistDisplay) => {
    setSelectedPlaylist(playlist);
    setView('detail');
    const all = await loadAllPlaylists();
    const found = all.find((p) => p.id === playlist.id);
    setTracks(found ? found.tracks : []);
  };

  const removeTrack = async (trackId: number) => {
    if (!selectedPlaylist) return;
    const all = await loadAllPlaylists();
    const updated = all.map((p) =>
      p.id === selectedPlaylist.id
        ? { ...p, synced: false, tracks: p.tracks.filter((t) => t.id !== trackId) }
        : p
    );
    await saveAllPlaylists(updated);
    const found = updated.find((p) => p.id === selectedPlaylist.id);
    setTracks(found ? found.tracks : []);
    await refreshPlaylists();
  };

  const syncToEngineDJ = async (playlist: PlaylistDisplay) => {
    if (!sdCardPath) {
      Alert.alert(
        'Kein Speichermedium',
        'Bitte zuerst ein Speichermedium (SD-Karte oder USB-Stick) auswählen.',
        [{ text: 'OK' }]
      );
      return;
    }
    await syncToEngineDJWithPath(playlist, sdCardPath);
  };

  const scanExportTargets = async () => {
    setScanningUsb(true);
    const targets: ExportTarget[] = [];

    if (sdCardPath) {
      let hasEngineLibrary = false;
      if (sdCardPath.startsWith('content://')) {
        const saf = (FileSystem as any).StorageAccessFramework;
        if (saf && typeof saf.readDirectoryAsync === 'function') {
          const entries: string[] = await saf.readDirectoryAsync(sdCardPath).catch(() => []);
          hasEngineLibrary = entries.some((e: string) =>
            decodeURIComponent(e).toLowerCase().includes('engine library')
          );
        }
      } else {
        const uri = 'file://' + sdCardPath + '/Engine Library';
        const info = await FileSystem.getInfoAsync(uri).catch(() => ({ exists: false }));
        hasEngineLibrary = !!info.exists;
      }
      targets.push({
        path: sdCardPath,
        label: sdCardPath.includes('usb') || sdCardPath.includes('Usb') ? 'USB-Stick (aktiv)' : 'SD-Karte (aktiv)',
        hasEngineLibrary,
      });
    }

    const dynamicPaths: { path: string; label: string }[] = [];
    const dynamicRoots = ['/storage', '/mnt/media_rw'];
    for (const root of dynamicRoots) {
      try {
        const entries = await FileSystem.readDirectoryAsync('file://' + root).catch(() => []);
        for (const entry of entries) {
          if (entry === 'emulated' || entry === 'self') continue;
          const fullPath = root + '/' + entry;
          const alreadyKnown = USB_CANDIDATES.some((c) => c.path === fullPath) || fullPath === sdCardPath;
          if (!alreadyKnown) {
            dynamicPaths.push({ path: fullPath, label: `Wechseldatenträger (${entry})` });
          }
        }
      } catch {
        // not accessible
      }
    }

    const allCandidates = [
      ...USB_CANDIDATES.map((c) => ({ path: c.path, label: c.label })),
      ...dynamicPaths,
    ];
    await Promise.all(
      allCandidates.map(async (c) => {
        if (sdCardPath && c.path === sdCardPath) return;
        try {
          const baseInfo = await FileSystem.getInfoAsync('file://' + c.path);
          if (!baseInfo.exists) return;
          const libUri = 'file://' + c.path + '/Engine Library';
          const libInfo = await FileSystem.getInfoAsync(libUri).catch(() => ({ exists: false }));
          targets.push({ path: c.path, label: c.label, hasEngineLibrary: !!libInfo.exists });
        } catch {
          // not accessible
        }
      })
    );

    setExportTargets(targets);
    setScanningUsb(false);
  };

  const openUsbExportSheet = async (playlist: PlaylistDisplay) => {
    setTargetPlaylist(playlist);
    setShowTargetSheet(true);
    Animated.spring(targetSheetAnim, {
      toValue: 1,
      tension: 65,
      friction: 11,
      useNativeDriver: true,
    }).start();
    await scanExportTargets();
  };

  const closeTargetSheet = () => {
    Animated.timing(targetSheetAnim, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      setShowTargetSheet(false);
      setTargetPlaylist(null);
    });
  };

  const exportToTarget = async (target: ExportTarget) => {
    if (!targetPlaylist) return;
    closeTargetSheet();
    await syncToEngineDJWithPath(targetPlaylist, target.path);
  };

  const syncToEngineDJWithPath = async (playlist: PlaylistDisplay, targetPath: string) => {
    setSyncing(true);
    setSyncStatus('Lade Tracks...');
    try {
      const all = await loadAllPlaylists();
      const found = all.find((p) => p.id === playlist.id);
      const trackRows = found ? found.tracks : [];

      const safeTitle = playlist.title.replace(/[/\\?%*:|"<>]/g, '_');
      const lines: string[] = ['#EXTM3U', `#PLAYLIST:${playlist.title}`, ''];
      for (const t of trackRows) {
        const artist = t.artist || 'Unknown';
        const title = t.title || 'Unknown';
        lines.push(`#EXTINF:-1,${artist} - ${title}`);
        if (t.bpm) lines.push(`#EXT-X-BPM:${t.bpm}`);
        if (t.key) lines.push(`#EXT-X-KEY-CAMELOT:${t.key}`);
        const trackPath = t.path.startsWith('content://') ? safUriToFilePath(t.path) : t.path;
        lines.push(trackPath);
      }
      const m3u8Content = lines.join('\n');

      if (targetPath.startsWith('content://')) {
        const saf = (FileSystem as any).StorageAccessFramework;
        if (!saf || typeof saf.readDirectoryAsync !== 'function') {
          throw new Error('StorageAccessFramework nicht verfügbar');
        }

        setSyncStatus('Suche Engine Library Ordner...');
        const rootEntries: string[] = await saf.readDirectoryAsync(targetPath).catch(() => []);
        let engineLibUri = rootEntries.find((e: string) =>
          decodeURIComponent(e).toLowerCase().includes('engine library')
        );
        if (!engineLibUri) {
          engineLibUri = await saf.makeDirectoryAsync(targetPath, 'Engine Library').catch(() => null);
          if (!engineLibUri) throw new Error('Engine Library Ordner konnte nicht erstellt werden');
        }

        setSyncStatus('Erstelle Playlist-Verzeichnis...');
        const libEntries: string[] = await saf.readDirectoryAsync(engineLibUri).catch(() => []);
        let playlistsDirUri = libEntries.find((e: string) =>
          decodeURIComponent(e).toLowerCase().includes('playlists')
        );
        if (!playlistsDirUri) {
          playlistsDirUri = await saf.makeDirectoryAsync(engineLibUri, 'Playlists').catch(() => null);
          if (!playlistsDirUri) throw new Error('Playlists Ordner konnte nicht erstellt werden');
        }

        setSyncStatus(`Schreibe "${safeTitle}.m3u8"...`);
        // Check if file already exists; if so reuse its URI to overwrite, else create new
        const playlistsEntries: string[] = await saf.readDirectoryAsync(playlistsDirUri).catch(() => []);
        const existingFileUri = playlistsEntries.find((e: string) =>
          decodeURIComponent(e).toLowerCase().endsWith(safeTitle.toLowerCase() + '.m3u8')
        );
        let fileUri: string;
        if (existingFileUri) {
          fileUri = existingFileUri;
        } else {
          fileUri = await saf.createFileAsync(playlistsDirUri, safeTitle + '.m3u8', 'audio/x-mpegurl');
        }
        if (!fileUri) throw new Error('Playlist-Datei konnte nicht erstellt werden');
        await saf.writeAsStringAsync(fileUri, m3u8Content, { encoding: FileSystem.EncodingType.UTF8 });
      } else {
        setSyncStatus('Erstelle Playlist-Verzeichnis...');
        const playlistDir = 'file://' + targetPath + '/Engine Library/Playlists';
        const dirInfo = await FileSystem.getInfoAsync(playlistDir);
        if (!dirInfo.exists) {
          await FileSystem.makeDirectoryAsync(playlistDir, { intermediates: true });
        }

        setSyncStatus(`Schreibe "${safeTitle}.m3u8"...`);
        await FileSystem.writeAsStringAsync(
          playlistDir + '/' + safeTitle + '.m3u8',
          m3u8Content,
          { encoding: FileSystem.EncodingType.UTF8 }
        );
      }

      setSyncStatus('Aktualisiere Sync-Status...');
      const allUpdated = all.map((p) =>
        p.id === playlist.id ? { ...p, synced: true } : p
      );
      await saveAllPlaylists(allUpdated);
      await refreshPlaylists();
      if (selectedPlaylist?.id === playlist.id) {
        setSelectedPlaylist({ ...playlist, synced: true });
      }

      setSyncStatus('Export abgeschlossen.');
      await new Promise((r) => setTimeout(r, 400));

      const mediumLabel = targetPath.includes('usb') || targetPath.includes('Usb') ? 'USB-Stick' : 'SD-Karte';
      Alert.alert(
        'Export erfolgreich',
        `"${playlist.title}" wurde als M3U8-Datei auf ${mediumLabel} exportiert.\n\nPfad: Engine Library/Playlists/${safeTitle}.m3u8`,
        [{ text: 'OK' }]
      );
    } catch (e: any) {
      Alert.alert(
        'Export Fehler',
        `Export fehlgeschlagen: ${e?.message || 'Unbekannter Fehler'}\n\nBitte prüfen ob das Speichermedium beschreibbar ist.`
      );
    } finally {
      setSyncing(false);
      setSyncStatus('');
    }
  };

  const sheetTranslateY = sheetAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [300, 0],
  });

  const isUsb = targetType === 'usb';
  const accentColor = isUsb ? '#F59E0B' : '#22C55E';
  const mediumIcon: any = isUsb ? 'logo-usb' : 'hardware-chip';

  const renderPlaylistItem = useCallback(
    ({ item }: { item: PlaylistDisplay }) => <PlaylistRow
      item={item}
      onPress={() => openPlaylist(item)}
      onSync={() => syncToEngineDJ(item)}
      onUsbExport={() => openUsbExportSheet(item)}
      onEdit={() => {
        setSelectedPlaylist(item);
        setEditName(item.title);
        openSheet('edit');
      }}
      onDelete={() => deletePlaylist(item)}
      accentColor={accentColor}
      mediumIcon={mediumIcon}
    />,
    [sdCardPath, exportTargets, accentColor, mediumIcon]
  );

  const removeTrackCb = useCallback(
    (trackId: number) => removeTrack(trackId),
    [selectedPlaylist]
  );

  const renderTrackItem = useCallback(
    ({ item }: { item: Track }) => <TrackRow item={item} onRemove={() => removeTrackCb(item.id)} />,
    [removeTrackCb]
  );
  const mediumLabel = isUsb ? 'USB-Stick' : 'SD-Karte';

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={Theme.colors.primary} />
          <Text style={styles.loadingText}>Lade Playlists...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
    <Animated.View style={[styles.container, { opacity: fadeAnim }]}>
      {/* Header */}
      <View style={styles.header}>
        {view === 'detail' ? (
          <TouchableOpacity onPress={() => { setView('list'); setSelectedPlaylist(null); }} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={24} color={Theme.colors.text} />
          </TouchableOpacity>
        ) : (
          <View style={styles.backBtn} />
        )}
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>
            {view === 'detail' && selectedPlaylist ? selectedPlaylist.title : 'Playlists'}
          </Text>
          {view === 'detail' && selectedPlaylist && (
            <Text style={styles.headerSub}>
              {selectedPlaylist.trackCount} {selectedPlaylist.trackCount === 1 ? 'Track' : 'Tracks'}
            </Text>
          )}
        </View>
        <View style={styles.headerRight}>
          {view === 'detail' && selectedPlaylist ? (
            <View style={styles.headerActions}>
              <TouchableOpacity
                onPress={() => {
                  setEditName(selectedPlaylist.title);
                  openSheet('edit');
                }}
                style={styles.iconBtn}
              >
                <Ionicons name="pencil" size={20} color={Theme.colors.textSecondary} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => openUsbExportSheet(selectedPlaylist)}
                style={styles.iconBtn}
              >
                <Ionicons name={mediumIcon} size={20} color={accentColor} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => syncToEngineDJ(selectedPlaylist)}
                style={styles.iconBtn}
              >
                <Ionicons name="sync" size={20} color={Theme.colors.primary} />
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity onPress={() => openSheet('create')} style={styles.addBtn}>
              <Ionicons name="add" size={22} color={Theme.colors.text} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* SD Card status bar */}
      <View style={[styles.sdBar, { backgroundColor: sdCardPath ? Theme.colors.surface : 'rgba(245,158,11,0.12)' }]}>
        <Ionicons
          name={sdCardPath ? mediumIcon : 'warning-outline'}
          size={14}
          color={sdCardPath ? accentColor : Theme.colors.warning}
        />
        <Text style={[styles.sdText, { color: sdCardPath ? accentColor : Theme.colors.warning }]}>
          {sdCardPath
            ? `${mediumLabel}: ${sdCardPath.startsWith('content://') ? 'SAF-Zugriff aktiv' : sdCardPath.split('/').pop()}`
            : 'Kein Speichermedium verbunden'}
        </Text>
      </View>

      {/* Sync progress overlay */}
      {syncing && (
        <View style={styles.syncOverlay}>
          <View style={styles.syncCard}>
            <ActivityIndicator size="small" color={Theme.colors.primary} />
            <Text style={styles.syncTitle}>Sync läuft</Text>
            <Text style={styles.syncStatus}>{syncStatus}</Text>
            <View style={styles.formatRow}>
              <FormatBadge label="Engine DJ" />
              <FormatBadge label="M3U8" />
              <FormatBadge label="Camelot" />
            </View>
          </View>
        </View>
      )}

      {/* Content */}
      {view === 'list' ? (
        playlists.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="musical-notes-outline" size={56} color={Theme.colors.textMuted} />
            <Text style={styles.emptyTitle}>Keine Playlists</Text>
            <Text style={styles.emptyText}>Tippe auf + um eine Playlist zu erstellen</Text>
          </View>
        ) : (
          <FlatList
            data={playlists}
            keyExtractor={(item) => String(item.id)}
            renderItem={renderPlaylistItem}
            contentContainerStyle={styles.listContent}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
          />
        )
      ) : (
        tracks.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="list-outline" size={48} color={Theme.colors.textMuted} />
            <Text style={styles.emptyTitle}>Playlist ist leer</Text>
            <Text style={styles.emptyText}>Tracks können aus der Ordneransicht hinzugefügt werden</Text>
          </View>
        ) : (
          <FlatList
            data={tracks}
            keyExtractor={(item) => String(item.id)}
            renderItem={renderTrackItem}
            contentContainerStyle={styles.listContent}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
          />
        )
      )}

      {/* Bottom sheet backdrop */}
      {(showCreateSheet || showEditSheet) && (
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={closeSheet} />
      )}
      {showTargetSheet && (
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={closeTargetSheet} />
      )}

      {/* Create sheet */}
      {showCreateSheet && (
        <Animated.View style={[styles.sheet, { transform: [{ translateY: sheetTranslateY }] }]}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Neue Playlist</Text>
          <TextInput
            style={styles.input}
            placeholder="Playlist-Name..."
            placeholderTextColor={Theme.colors.placeholder}
            value={newPlaylistName}
            onChangeText={setNewPlaylistName}
            autoFocus
            maxLength={60}
          />
          <TouchableOpacity
            style={[styles.sheetBtn, !newPlaylistName.trim() && styles.sheetBtnDisabled]}
            onPress={createPlaylist}
            disabled={!newPlaylistName.trim()}
          >
            <Text style={styles.sheetBtnText}>Erstellen</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.sheetCancelBtn} onPress={closeSheet}>
            <Text style={styles.sheetCancelText}>Abbrechen</Text>
          </TouchableOpacity>
        </Animated.View>
      )}

      {/* Edit sheet */}
      {showEditSheet && (
        <Animated.View style={[styles.sheet, { transform: [{ translateY: sheetTranslateY }] }]}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Playlist umbenennen</Text>
          <TextInput
            style={styles.input}
            placeholder="Playlist-Name..."
            placeholderTextColor={Theme.colors.placeholder}
            value={editName}
            onChangeText={setEditName}
            autoFocus
            maxLength={60}
          />
          <TouchableOpacity
            style={[styles.sheetBtn, !editName.trim() && styles.sheetBtnDisabled]}
            onPress={renamePlaylist}
            disabled={!editName.trim()}
          >
            <Text style={styles.sheetBtnText}>Speichern</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.sheetCancelBtn} onPress={closeSheet}>
            <Text style={styles.sheetCancelText}>Abbrechen</Text>
          </TouchableOpacity>
        </Animated.View>
      )}

      {/* USB / SD Export Target Sheet */}
      {showTargetSheet && (
        <Animated.View style={[styles.sheet, styles.targetSheet, { transform: [{ translateY: targetSheetAnim.interpolate({ inputRange: [0, 1], outputRange: [400, 0] }) }] }]}>
          <View style={styles.sheetHandle} />
          <View style={styles.targetSheetHeader}>
            <Ionicons name={mediumIcon} size={20} color={accentColor} />
            <Text style={styles.sheetTitle}>
              {targetPlaylist ? `"${targetPlaylist.title}" exportieren` : 'Ziel wählen'}
            </Text>
          </View>

          {scanningUsb ? (
            <View style={styles.usbScanRow}>
              <ActivityIndicator size="small" color={Theme.colors.primary} />
              <Text style={styles.usbScanText}>Suche nach Speichermedien…</Text>
            </View>
          ) : exportTargets.length === 0 ? (
            <View style={styles.usbScanRow}>
              <Ionicons name="warning-outline" size={20} color={Theme.colors.warning} />
              <Text style={styles.usbScanText}>Kein Speichermedium gefunden. USB-Stick verbinden.</Text>
            </View>
          ) : (
            <ScrollView style={styles.targetList} contentContainerStyle={{ gap: 8 }} showsVerticalScrollIndicator={false}>
              {exportTargets.map((t) => (
                <TouchableOpacity key={t.path} style={styles.targetRow} onPress={() => exportToTarget(t)}>
                  <View style={styles.targetIconWrap}>
                    <Ionicons
                      name={t.path.includes('usb') || t.path.includes('Usb') ? 'logo-usb' : 'hardware-chip'}
                      size={22}
                      color={t.hasEngineLibrary ? Theme.colors.primary : '#F59E0B'}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.targetLabel}>{t.label}</Text>
                    <Text style={styles.targetPath} numberOfLines={1}>{t.path}</Text>
                    {t.hasEngineLibrary && (
                      <View style={styles.targetBadge}>
                        <Ionicons name="checkmark-circle" size={10} color={Theme.colors.primary} />
                        <Text style={styles.targetBadgeText}>Engine Library vorhanden</Text>
                      </View>
                    )}
                  </View>
                  <Ionicons name="arrow-forward-circle" size={22} color={Theme.colors.primary} />
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          <TouchableOpacity style={styles.sheetCancelBtn} onPress={closeTargetSheet}>
            <Text style={styles.sheetCancelText}>Abbrechen</Text>
          </TouchableOpacity>
        </Animated.View>
      )}
    </Animated.View>
    </SafeAreaView>
  );
};

// --- Sub-components ---

interface PlaylistRowProps {
  item: PlaylistDisplay;
  onPress: () => void;
  onSync: () => void;
  onUsbExport: () => void;
  onEdit: () => void;
  onDelete: () => void;
  accentColor: string;
  mediumIcon: string;
}

const PlaylistRow: React.FC<PlaylistRowProps> = ({ item, onPress, onSync, onUsbExport, onEdit, onDelete, accentColor, mediumIcon }) => {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const onPressIn = () =>
    Animated.spring(scaleAnim, { toValue: 0.97, useNativeDriver: true, tension: 300, friction: 10 }).start();
  const onPressOut = () =>
    Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, tension: 300, friction: 10 }).start();

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <TouchableOpacity
        style={styles.playlistRow}
        onPress={onPress}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        activeOpacity={1}
      >
        <View style={styles.playlistIcon}>
          <Ionicons name="musical-notes" size={20} color={Theme.colors.primary} />
        </View>
        <View style={styles.playlistInfo}>
          <Text style={styles.playlistTitle} numberOfLines={1}>{item.title}</Text>
          <View style={styles.playlistMeta}>
            <Text style={styles.playlistSub}>
              {item.trackCount} {item.trackCount === 1 ? 'Track' : 'Tracks'}
            </Text>
            {item.synced && (
              <View style={styles.syncedBadge}>
                <Ionicons name="checkmark-circle" size={10} color={Theme.colors.primary} />
                <Text style={styles.syncedText}>Synced</Text>
              </View>
            )}
          </View>
        </View>
        <View style={styles.rowActions}>
          <TouchableOpacity onPress={onUsbExport} style={styles.rowIconBtn} hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
            <Ionicons name={mediumIcon as any} size={18} color={accentColor} />
          </TouchableOpacity>
          <TouchableOpacity onPress={onSync} style={styles.rowIconBtn} hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
            <Ionicons name="sync-outline" size={18} color={Theme.colors.primary} />
          </TouchableOpacity>
          <TouchableOpacity onPress={onEdit} style={styles.rowIconBtn} hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
            <Ionicons name="pencil-outline" size={18} color={Theme.colors.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity onPress={onDelete} style={styles.rowIconBtn} hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
            <Ionicons name="trash-outline" size={18} color={Theme.colors.error} />
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
};

interface TrackRowProps {
  item: Track;
  onRemove: () => void;
}

const TrackRow: React.FC<TrackRowProps> = ({ item, onRemove }) => (
  <View style={styles.trackRow}>
    <View style={styles.trackPos}>
      <Text style={styles.trackPosText}>{item.position + 1}</Text>
    </View>
    <View style={styles.trackInfo}>
      <Text style={styles.trackTitle} numberOfLines={1}>{item.title}</Text>
      <Text style={styles.trackArtist} numberOfLines={1}>{item.artist || 'Unbekannt'}</Text>
    </View>
    <View style={styles.trackMeta}>
      {item.bpm != null && (
        <View style={styles.metaBadge}>
          <Text style={styles.metaBadgeText}>{Math.round(item.bpm)}</Text>
        </View>
      )}
      {item.key && (
        <View style={[styles.metaBadge, styles.keyBadge]}>
          <Text style={styles.metaBadgeText}>{item.key}</Text>
        </View>
      )}
    </View>
    <TouchableOpacity onPress={onRemove} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
      <Ionicons name="remove-circle-outline" size={20} color={Theme.colors.error} />
    </TouchableOpacity>
  </View>
);

interface FormatBadgeProps {
  label: string;
}

const FormatBadge: React.FC<FormatBadgeProps> = ({ label }) => (
  <View style={styles.fmtBadge}>
    <Text style={styles.fmtBadgeText}>{label}</Text>
  </View>
);

// --- Styles ---

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Theme.colors.background,
  },
  container: {
    flex: 1,
    backgroundColor: Theme.colors.background,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Theme.colors.background,
  },
  loadingText: {
    marginTop: Theme.spacing.sm,
    color: Theme.colors.textSecondary,
    fontSize: Theme.typography.fontSize.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: Theme.spacing.md,
    paddingBottom: Theme.spacing.md,
    paddingHorizontal: Theme.spacing.md,
    backgroundColor: Theme.colors.background,
    borderBottomWidth: 1,
    borderBottomColor: Theme.colors.divider,
  },
  backBtn: {
    width: 36,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: Theme.typography.fontSize.xl,
    fontWeight: Theme.typography.fontWeight.bold as any,
    color: Theme.colors.text,
  },
  headerSub: {
    fontSize: Theme.typography.fontSize.sm,
    color: Theme.colors.textSecondary,
    marginTop: 2,
  },
  headerRight: {
    width: 36,
    alignItems: 'flex-end',
  },
  headerActions: {
    flexDirection: 'row',
    gap: 8,
  },
  iconBtn: {
    padding: 4,
  },
  addBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Theme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sdBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: Theme.colors.divider,
  },
  sdText: {
    fontSize: Theme.typography.fontSize.sm,
    fontWeight: Theme.typography.fontWeight.medium as any,
  },
  listContent: {
    padding: Theme.spacing.md,
    paddingBottom: 80,
  },
  separator: {
    height: 8,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Theme.spacing.sm,
    paddingHorizontal: Theme.spacing.xl,
  },
  emptyTitle: {
    fontSize: Theme.typography.fontSize.xl,
    fontWeight: Theme.typography.fontWeight.semibold as any,
    color: Theme.colors.text,
    marginTop: Theme.spacing.sm,
  },
  emptyText: {
    fontSize: Theme.typography.fontSize.md,
    color: Theme.colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  playlistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Theme.colors.surface,
    borderRadius: Theme.borderRadius.md,
    padding: Theme.spacing.md,
    ...Theme.elevation.sm,
  },
  playlistIcon: {
    width: 44,
    height: 44,
    borderRadius: Theme.borderRadius.sm,
    backgroundColor: 'rgba(29,185,84,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Theme.spacing.md,
  },
  playlistInfo: {
    flex: 1,
  },
  playlistTitle: {
    fontSize: Theme.typography.fontSize.lg,
    fontWeight: Theme.typography.fontWeight.semibold as any,
    color: Theme.colors.text,
  },
  playlistMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 3,
  },
  playlistSub: {
    fontSize: Theme.typography.fontSize.sm,
    color: Theme.colors.textSecondary,
  },
  syncedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(29,185,84,0.12)',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  syncedText: {
    fontSize: 10,
    color: Theme.colors.primary,
    fontWeight: Theme.typography.fontWeight.medium as any,
  },
  rowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginLeft: Theme.spacing.sm,
  },
  rowIconBtn: {
    padding: 6,
  },
  trackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Theme.colors.surface,
    borderRadius: Theme.borderRadius.md,
    padding: Theme.spacing.md,
    gap: Theme.spacing.sm,
  },
  trackPos: {
    width: 28,
    alignItems: 'center',
  },
  trackPosText: {
    fontSize: Theme.typography.fontSize.sm,
    color: Theme.colors.textMuted,
    fontWeight: Theme.typography.fontWeight.medium as any,
  },
  trackInfo: {
    flex: 1,
  },
  trackTitle: {
    fontSize: Theme.typography.fontSize.md,
    fontWeight: Theme.typography.fontWeight.medium as any,
    color: Theme.colors.text,
  },
  trackArtist: {
    fontSize: Theme.typography.fontSize.sm,
    color: Theme.colors.textSecondary,
    marginTop: 2,
  },
  trackMeta: {
    flexDirection: 'row',
    gap: 4,
  },
  metaBadge: {
    backgroundColor: 'rgba(29,185,84,0.15)',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  keyBadge: {
    backgroundColor: 'rgba(80,155,245,0.15)',
  },
  metaBadgeText: {
    fontSize: 10,
    color: Theme.colors.text,
    fontWeight: Theme.typography.fontWeight.semibold as any,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
    zIndex: 10,
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: Theme.colors.card,
    borderTopLeftRadius: Theme.borderRadius.xl,
    borderTopRightRadius: Theme.borderRadius.xl,
    padding: Theme.spacing.xl,
    paddingBottom: 40,
    zIndex: 11,
    ...Theme.elevation.xl,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Theme.colors.border,
    alignSelf: 'center',
    marginBottom: Theme.spacing.lg,
  },
  sheetTitle: {
    fontSize: Theme.typography.fontSize.xxl,
    fontWeight: Theme.typography.fontWeight.bold as any,
    color: Theme.colors.text,
    marginBottom: Theme.spacing.lg,
  },
  input: {
    backgroundColor: Theme.colors.surface,
    borderRadius: Theme.borderRadius.md,
    padding: Theme.spacing.md,
    fontSize: Theme.typography.fontSize.md,
    color: Theme.colors.text,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    marginBottom: Theme.spacing.lg,
  },
  sheetBtn: {
    backgroundColor: Theme.colors.primary,
    borderRadius: Theme.borderRadius.md,
    padding: Theme.spacing.md,
    alignItems: 'center',
    marginBottom: Theme.spacing.sm,
  },
  sheetBtnDisabled: {
    opacity: 0.4,
  },
  sheetBtnText: {
    fontSize: Theme.typography.fontSize.md,
    fontWeight: Theme.typography.fontWeight.semibold as any,
    color: Theme.colors.black,
  },
  sheetCancelBtn: {
    padding: Theme.spacing.md,
    alignItems: 'center',
  },
  sheetCancelText: {
    fontSize: Theme.typography.fontSize.md,
    color: Theme.colors.textSecondary,
  },
  targetSheet: {
    maxHeight: '70%',
  },
  targetSheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: -Theme.spacing.sm,
  },
  usbScanRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Theme.spacing.sm,
    paddingVertical: Theme.spacing.lg,
    justifyContent: 'center',
  },
  usbScanText: {
    fontSize: Theme.typography.fontSize.sm,
    color: Theme.colors.textSecondary,
    textAlign: 'center',
    flex: 1,
  },
  targetList: {
    maxHeight: 300,
    marginVertical: Theme.spacing.md,
  },
  targetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Theme.colors.surface,
    borderRadius: Theme.borderRadius.md,
    padding: Theme.spacing.md,
    gap: Theme.spacing.md,
    borderWidth: 1,
    borderColor: Theme.colors.border,
  },
  targetIconWrap: {
    width: 44,
    height: 44,
    borderRadius: Theme.borderRadius.sm,
    backgroundColor: 'rgba(245,158,11,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  targetLabel: {
    fontSize: Theme.typography.fontSize.md,
    fontWeight: Theme.typography.fontWeight.semibold as any,
    color: Theme.colors.text,
  },
  targetPath: {
    fontSize: 10,
    color: Theme.colors.textMuted,
    fontFamily: 'monospace' as any,
    marginTop: 2,
  },
  targetBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginTop: 4,
  },
  targetBadgeText: {
    fontSize: 10,
    color: Theme.colors.primary,
    fontWeight: Theme.typography.fontWeight.medium as any,
  },
  syncOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
  },
  syncCard: {
    backgroundColor: Theme.colors.card,
    borderRadius: Theme.borderRadius.lg,
    padding: Theme.spacing.xl,
    alignItems: 'center',
    gap: Theme.spacing.md,
    minWidth: 260,
    ...Theme.elevation.xl,
  },
  syncTitle: {
    fontSize: Theme.typography.fontSize.xl,
    fontWeight: Theme.typography.fontWeight.bold as any,
    color: Theme.colors.text,
  },
  syncStatus: {
    fontSize: Theme.typography.fontSize.sm,
    color: Theme.colors.textSecondary,
    textAlign: 'center',
  },
  formatRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 4,
  },
  fmtBadge: {
    backgroundColor: 'rgba(29,185,84,0.15)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  fmtBadgeText: {
    fontSize: 10,
    fontWeight: Theme.typography.fontWeight.bold as any,
    color: Theme.colors.primary,
    letterSpacing: 0.5,
  },
});

export default PlaylistManagerPage;
