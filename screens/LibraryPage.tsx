import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList, TextInput,
  ActivityIndicator, Alert, Animated, SafeAreaView, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Theme } from '../theme/AppTheme';
import {
  DBTrack, DBPlaylist,
  getAllTracks, getAllPlaylists, searchTracks,
  createPlaylist, deletePlaylist, renamePlaylist,
  getPlaylistTracks, addTrackToPlaylist, removeTrackFromPlaylist,
  importFolderAsPlaylist, getLibraryStats, LibraryStats,
  migrateFromAsyncStorage,
} from '../utils/LibraryDatabase';
import {
  detectEngineVolumes, syncToEngineDJ, importEngineLibrary,
  EngineVolume, EngineSyncResult,
} from '../utils/EngineDJDatabase';
import { scanMusicLibrary, ScanProgress } from '../utils/MusicScanner';

const PLAYLIST_LEGACY_KEY = '@dj_playlists_v2';
const STORAGE_KEY = '@dj_engine_selected_card';

type Tab = 'tracks' | 'playlists' | 'sync';

// ── Sub-components ─────────────────────────────────────────────────────────────

interface TrackRowProps {
  track: DBTrack;
  onLongPress: (t: DBTrack) => void;
}
const TrackRow: React.FC<TrackRowProps> = ({ track, onLongPress }) => {
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: 250, useNativeDriver: true }).start();
  }, []);
  const bpmStr = track.bpm ? track.bpm.toFixed(1) : '—';
  const key    = track.key_camelot || track.key_open || '—';
  return (
    <Animated.View style={{ opacity }}>
      <TouchableOpacity style={styles.trackRow} onLongPress={() => onLongPress(track)} activeOpacity={0.7}>
        <View style={styles.trackIcon}>
          <Ionicons name="musical-note" size={16} color={Theme.colors.primary} />
        </View>
        <View style={styles.trackInfo}>
          <Text style={styles.trackTitle} numberOfLines={1}>{track.title || track.filename}</Text>
          <Text style={styles.trackArtist} numberOfLines={1}>{track.artist || 'Unbekannt'}</Text>
        </View>
        <View style={styles.trackMeta}>
          <Text style={styles.metaText}>{bpmStr}</Text>
          <Text style={[styles.metaText, { color: Theme.colors.primary, fontSize: 11 }]}>{key}</Text>
          {track.is_analyzed === 1 && (
            <Ionicons name="checkmark-circle" size={12} color={Theme.colors.primary} />
          )}
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
};

interface PlaylistRowProps {
  playlist: DBPlaylist;
  onPress: (p: DBPlaylist) => void;
  onLongPress: (p: DBPlaylist) => void;
}
const PlaylistRow: React.FC<PlaylistRowProps> = ({ playlist, onPress, onLongPress }) => {
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: 250, useNativeDriver: true }).start();
  }, []);
  return (
    <Animated.View style={{ opacity }}>
      <TouchableOpacity
        style={styles.playlistRow}
        onPress={() => onPress(playlist)}
        onLongPress={() => onLongPress(playlist)}
        activeOpacity={0.7}
      >
        <View style={styles.playlistIcon}>
          <Ionicons
            name={playlist.is_folder ? 'folder' : 'list'}
            size={18}
            color={playlist.synced_at ? Theme.colors.primary : Theme.colors.textSecondary}
          />
        </View>
        <View style={styles.playlistInfo}>
          <Text style={styles.playlistTitle} numberOfLines={1}>{playlist.title}</Text>
          <Text style={styles.playlistMeta}>
            {playlist.track_count} {playlist.track_count === 1 ? 'Track' : 'Tracks'}
            {playlist.synced_at ? ' · Synchronisiert' : ''}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={Theme.colors.textSecondary} />
      </TouchableOpacity>
    </Animated.View>
  );
};

interface VolumeCardProps {
  volume: EngineVolume;
  onImport: (v: EngineVolume) => void;
  onSync: (v: EngineVolume) => void;
}
const VolumeCard: React.FC<VolumeCardProps> = ({ volume, onImport, onSync }) => (
  <View style={styles.volumeCard}>
    <Ionicons
      name={volume.type === 'usb' ? 'logo-usb' : volume.type === 'sd' ? 'hardware-chip' : 'phone-portrait'}
      size={28}
      color={volume.hasEngineLibrary ? Theme.colors.primary : Theme.colors.textSecondary}
    />
    <View style={{ flex: 1, marginHorizontal: 12 }}>
      <Text style={styles.volumeLabel}>{volume.label}</Text>
      <Text style={styles.volumeDetails}>
        {volume.hasEngineLibrary
          ? `Engine Library · ${volume.trackCount} Tracks`
          : 'Keine Engine Library'}
      </Text>
    </View>
    <View style={{ gap: 8 }}>
      {volume.hasEngineLibrary && (
        <TouchableOpacity style={styles.volBtn} onPress={() => onImport(volume)}>
          <Text style={styles.volBtnText}>Import</Text>
        </TouchableOpacity>
      )}
      <TouchableOpacity style={[styles.volBtn, { backgroundColor: Theme.colors.primary }]} onPress={() => onSync(volume)}>
        <Text style={[styles.volBtnText, { color: '#000' }]}>Sync</Text>
      </TouchableOpacity>
    </View>
  </View>
);

// ── Main component ─────────────────────────────────────────────────────────────

export default function LibraryPage() {
  const navigation = useNavigation<any>();
  const [activeTab, setActiveTab] = useState<Tab>('tracks');

  const [tracks, setTracks]       = useState<DBTrack[]>([]);
  const [playlists, setPlaylists] = useState<DBPlaylist[]>([]);
  const [volumes, setVolumes]     = useState<EngineVolume[]>([]);
  const [stats, setStats]         = useState<LibraryStats | null>(null);

  const [query, setQuery]         = useState('');
  const [loading, setLoading]     = useState(false);
  const [busyMsg, setBusyMsg]     = useState('');

  // Playlist detail view
  const [selectedPlaylist, setSelectedPlaylist] = useState<DBPlaylist | null>(null);
  const [playlistTracks, setPlaylistTracks]     = useState<DBTrack[]>([]);

  const fadeAnim = useRef(new Animated.Value(0)).current;

  // ── Load data ────────────────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      // Migrate legacy AsyncStorage playlists once
      const legacyRaw = await AsyncStorage.getItem(PLAYLIST_LEGACY_KEY);
      if (legacyRaw) {
        const legacy = JSON.parse(legacyRaw);
        if (Array.isArray(legacy) && legacy.length > 0) {
          await migrateFromAsyncStorage(legacy);
          await AsyncStorage.removeItem(PLAYLIST_LEGACY_KEY);
        }
      }

      const [t, p, s] = await Promise.all([
        getAllTracks(),
        getAllPlaylists(),
        getLibraryStats(),
      ]);
      setTracks(t);
      setPlaylists(p);
      setStats(s);
    } catch (e: any) {
      Alert.alert('Fehler', e?.message ?? String(e));
    } finally {
      setLoading(false);
      Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }).start();
    }
  }, []);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  // ── Volume detection ─────────────────────────────────────────────────────────

  const detectVolumes = useCallback(async () => {
    setLoading(true);
    setBusyMsg('Medien werden erkannt…');
    try {
      const vols = await detectEngineVolumes();
      setVolumes(vols);
    } finally {
      setLoading(false);
      setBusyMsg('');
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'sync') detectVolumes();
  }, [activeTab]);

  // ── Track operations ─────────────────────────────────────────────────────────

  const handleSearch = useCallback(async (q: string) => {
    setQuery(q);
    if (q.trim().length < 2) {
      const t = await getAllTracks();
      setTracks(t);
    } else {
      const t = await searchTracks(q);
      setTracks(t);
    }
  }, []);

  const handleTrackLongPress = useCallback((t: DBTrack) => {
    const options = playlists.filter(p => !p.is_folder).map(p => p.title);
    if (options.length === 0) {
      Alert.alert('Keine Playlist', 'Erstelle zuerst eine Playlist.');
      return;
    }
    Alert.alert(`"${t.title || t.filename}" hinzufügen`, 'Playlist wählen:', [
      ...playlists.filter(p => !p.is_folder).map(p => ({
        text: p.title,
        onPress: async () => {
          await addTrackToPlaylist(p.id, t.id);
          await loadData();
        },
      })),
      { text: 'Abbrechen', style: 'cancel' },
    ]);
  }, [playlists, loadData]);

  // ── Playlist operations ───────────────────────────────────────────────────────

  const handleCreatePlaylist = useCallback(() => {
    Alert.prompt('Neue Playlist', 'Name:', async (name) => {
      if (!name?.trim()) return;
      await createPlaylist(name.trim());
      await loadData();
    });
  }, [loadData]);

  const handlePlaylistPress = useCallback(async (pl: DBPlaylist) => {
    setSelectedPlaylist(pl);
    const t = await getPlaylistTracks(pl.id);
    setPlaylistTracks(t);
  }, []);

  const handlePlaylistLongPress = useCallback((pl: DBPlaylist) => {
    Alert.alert(pl.title, '', [
      {
        text: 'Umbenennen',
        onPress: () => Alert.prompt('Umbenennen', '', async (name) => {
          if (!name?.trim()) return;
          await renamePlaylist(pl.id, name.trim());
          await loadData();
        }, 'plain-text', pl.title),
      },
      {
        text: 'Löschen',
        style: 'destructive',
        onPress: () => Alert.alert('Löschen?', `"${pl.title}" wirklich löschen?`, [
          { text: 'Löschen', style: 'destructive', onPress: async () => {
            await deletePlaylist(pl.id);
            await loadData();
          }},
          { text: 'Abbrechen', style: 'cancel' },
        ]),
      },
      { text: 'Abbrechen', style: 'cancel' },
    ]);
  }, [loadData]);

  // ── Folder import as playlist ─────────────────────────────────────────────────

  const handleImportFolder = useCallback(async () => {
    const selectedCard = await AsyncStorage.getItem(STORAGE_KEY);
    if (!selectedCard) {
      Alert.alert('Kein Medium', 'Wähle zuerst ein Speichermedium.');
      return;
    }
    setLoading(true);
    setBusyMsg('Ordner werden gescannt…');
    try {
      let scanTotal = 0;
      const result = await scanMusicLibrary(selectedCard, (p: ScanProgress) => {
        scanTotal = p.found;
        setBusyMsg(`Scanne… ${p.found} Tracks gefunden`);
      });
      if (result.folders.length === 0) {
        Alert.alert('Keine Musik gefunden', 'Keine Audiodateien auf dem Medium.');
        return;
      }
      Alert.alert(
        'Ordner importieren',
        `${result.folders.length} Ordner mit ${result.totalTracks} Tracks gefunden. Jeden Ordner als eigene Playlist importieren?`,
        [
          {
            text: 'Importieren',
            onPress: async () => {
              setLoading(true);
              setBusyMsg('Erstelle Playlists…');
              let created = 0;
              for (const folder of result.folders) {
                await importFolderAsPlaylist(folder.name, folder.tracks);
                created++;
                setBusyMsg(`${created}/${result.folders.length} Ordner importiert`);
              }
              await loadData();
              Alert.alert('Fertig', `${created} Playlists aus Ordnern erstellt.`);
            },
          },
          { text: 'Abbrechen', style: 'cancel' },
        ],
      );
    } catch (e: any) {
      Alert.alert('Fehler', e?.message ?? String(e));
    } finally {
      setLoading(false);
      setBusyMsg('');
    }
  }, [loadData]);

  // ── Sync ──────────────────────────────────────────────────────────────────────

  const handleSyncToVolume = useCallback(async (volume: EngineVolume) => {
    setLoading(true);
    setBusyMsg(`Sync zu ${volume.label}…`);
    try {
      const allPlaylists = await getAllPlaylists();
      const playlistsWithTracks = await Promise.all(
        allPlaylists.filter(p => !p.is_folder).map(async pl => ({
          playlist: pl,
          tracks: await getPlaylistTracks(pl.id),
        })),
      );
      const allTracks = await getAllTracks();

      const result: EngineSyncResult = await syncToEngineDJ(
        volume.path, allTracks, playlistsWithTracks, { overwrite: true },
      );

      const msg = [
        `${result.tracksWritten} Tracks geschrieben`,
        `${result.playlistsWritten} Playlists synchronisiert`,
        result.errors.length > 0 ? `${result.errors.length} Fehler` : '',
      ].filter(Boolean).join('\n');

      Alert.alert('Sync abgeschlossen', msg);
      await detectVolumes();
    } catch (e: any) {
      Alert.alert('Sync-Fehler', e?.message ?? String(e));
    } finally {
      setLoading(false);
      setBusyMsg('');
    }
  }, [detectVolumes]);

  const handleImportFromVolume = useCallback(async (volume: EngineVolume) => {
    setLoading(true);
    setBusyMsg(`Importiere von ${volume.label}…`);
    try {
      const result = await importEngineLibrary(volume.path, (done, total) => {
        setBusyMsg(`Importiere… ${done}/${total}`);
      });
      await loadData();
      Alert.alert(
        'Import abgeschlossen',
        `${result.tracks} Tracks, ${result.playlists} Playlists importiert` +
        (result.errors.length > 0 ? `\n${result.errors.length} Fehler` : ''),
      );
    } catch (e: any) {
      Alert.alert('Import-Fehler', e?.message ?? String(e));
    } finally {
      setLoading(false);
      setBusyMsg('');
    }
  }, [loadData]);

  // ── Render helpers ────────────────────────────────────────────────────────────

  const renderTrackItem = useCallback(({ item }: { item: DBTrack }) => (
    <TrackRow track={item} onLongPress={handleTrackLongPress} />
  ), [handleTrackLongPress]);

  const renderPlaylistItem = useCallback(({ item }: { item: DBPlaylist }) => (
    <PlaylistRow playlist={item} onPress={handlePlaylistPress} onLongPress={handlePlaylistLongPress} />
  ), [handlePlaylistPress, handlePlaylistLongPress]);

  // ── Playlist detail overlay ───────────────────────────────────────────────────

  if (selectedPlaylist) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => setSelectedPlaylist(null)} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={24} color={Theme.colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle} numberOfLines={1}>{selectedPlaylist.title}</Text>
          <View style={{ width: 36 }} />
        </View>

        <FlatList
          data={playlistTracks}
          keyExtractor={t => String(t.id)}
          renderItem={({ item }) => (
            <TrackRow
              track={item}
              onLongPress={() => Alert.alert('Entfernen?', `"${item.title || item.filename}"`, [
                { text: 'Entfernen', style: 'destructive', onPress: async () => {
                  await removeTrackFromPlaylist(selectedPlaylist.id, item.id);
                  const updated = await getPlaylistTracks(selectedPlaylist.id);
                  setPlaylistTracks(updated);
                }},
                { text: 'Abbrechen', style: 'cancel' },
              ])}
            />
          )}
          ListEmptyComponent={<Text style={styles.emptyText}>Keine Tracks in dieser Playlist.</Text>}
          contentContainerStyle={{ paddingBottom: 40 }}
        />
      </SafeAreaView>
    );
  }

  // ── Main view ─────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={Theme.colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Bibliothek</Text>
        <TouchableOpacity onPress={loadData} style={styles.backBtn}>
          <Ionicons name="refresh" size={20} color={Theme.colors.primary} />
        </TouchableOpacity>
      </View>

      {/* Stats bar */}
      {stats && (
        <View style={styles.statsBar}>
          <Text style={styles.statItem}>{stats.totalTracks} Tracks</Text>
          <View style={styles.statDot} />
          <Text style={styles.statItem}>{stats.analyzedTracks} analysiert</Text>
          <View style={styles.statDot} />
          <Text style={styles.statItem}>{stats.totalPlaylists} Playlists</Text>
          {stats.avgBpm && (
            <>
              <View style={styles.statDot} />
              <Text style={styles.statItem}>Ø {stats.avgBpm.toFixed(0)} BPM</Text>
            </>
          )}
        </View>
      )}

      {/* Tab bar */}
      <View style={styles.tabBar}>
        {(['tracks', 'playlists', 'sync'] as Tab[]).map(tab => (
          <TouchableOpacity key={tab} style={styles.tabBtn} onPress={() => setActiveTab(tab)}>
            <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
              {tab === 'tracks' ? 'Tracks' : tab === 'playlists' ? 'Playlists' : 'Geräte'}
            </Text>
            {activeTab === tab && <View style={styles.tabIndicator} />}
          </TouchableOpacity>
        ))}
      </View>

      {/* Busy overlay */}
      {loading && (
        <View style={styles.busyBar}>
          <ActivityIndicator size="small" color={Theme.colors.primary} />
          {busyMsg ? <Text style={styles.busyText}>{busyMsg}</Text> : null}
        </View>
      )}

      {/* ── TRACKS TAB ── */}
      {activeTab === 'tracks' && (
        <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={handleSearch}
            placeholder="Titel, Artist, Album…"
            placeholderTextColor={Theme.colors.textSecondary}
          />
          <FlatList
            data={tracks}
            keyExtractor={t => String(t.id)}
            renderItem={renderTrackItem}
            ListEmptyComponent={
              <Text style={styles.emptyText}>
                {loading ? '' : 'Keine Tracks. Scanne Musik über die Startseite.'}
              </Text>
            }
            contentContainerStyle={{ paddingBottom: 40 }}
            getItemLayout={(_, index) => ({ length: 64, offset: 64 * index, index })}
            initialNumToRender={20}
            maxToRenderPerBatch={20}
          />
        </Animated.View>
      )}

      {/* ── PLAYLISTS TAB ── */}
      {activeTab === 'playlists' && (
        <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
          <View style={styles.actionsRow}>
            <TouchableOpacity style={styles.actionBtn} onPress={handleCreatePlaylist}>
              <Ionicons name="add-circle" size={18} color={Theme.colors.primary} />
              <Text style={styles.actionBtnText}>Neue Playlist</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionBtn} onPress={handleImportFolder}>
              <Ionicons name="folder-open" size={18} color={Theme.colors.primary} />
              <Text style={styles.actionBtnText}>Ordner importieren</Text>
            </TouchableOpacity>
          </View>
          <FlatList
            data={playlists}
            keyExtractor={p => String(p.id)}
            renderItem={renderPlaylistItem}
            ListEmptyComponent={<Text style={styles.emptyText}>Keine Playlists vorhanden.</Text>}
            contentContainerStyle={{ paddingBottom: 40 }}
          />
        </Animated.View>
      )}

      {/* ── SYNC TAB ── */}
      {activeTab === 'sync' && (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          <Text style={styles.sectionTitle}>Erkannte Geräte</Text>
          {!loading && volumes.length === 0 && (
            <Text style={styles.emptyText}>Kein Gerät gefunden. SD-Karte oder USB-Stick anschließen.</Text>
          )}
          {volumes.map(v => (
            <VolumeCard
              key={v.path}
              volume={v}
              onImport={handleImportFromVolume}
              onSync={handleSyncToVolume}
            />
          ))}
          <TouchableOpacity style={styles.rescanBtn} onPress={detectVolumes} disabled={loading}>
            <Ionicons name="refresh" size={16} color={Theme.colors.primary} />
            <Text style={styles.rescanBtnText}>Erneut suchen</Text>
          </TouchableOpacity>

          <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Unterstützte Geräte</Text>
          {[
            'Denon SC Live 2 / 3 / 4',
            'Denon Prime 2 / 4 / 4+',
            'Denon Prime Go',
            'Denon SC5000 / SC5000M',
            'Denon SC6000 / SC6000M',
            'Alle Engine DJ kompatiblen Geräte',
          ].map(device => (
            <View key={device} style={styles.deviceRow}>
              <Ionicons name="checkmark-circle" size={14} color={Theme.colors.primary} />
              <Text style={styles.deviceText}>{device}</Text>
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Theme.colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: Theme.colors.border,
  },
  backBtn: { width: 36, height: 36, justifyContent: 'center', alignItems: 'center' },
  headerTitle: {
    flex: 1, textAlign: 'center',
    fontSize: 17, fontWeight: '600' as const,
    color: Theme.colors.text,
  },
  statsBar: {
    flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap',
    paddingHorizontal: 16, paddingVertical: 8,
    backgroundColor: Theme.colors.backgroundSecondary,
  },
  statItem: { fontSize: 12, color: Theme.colors.textSecondary },
  statDot: {
    width: 3, height: 3, borderRadius: 1.5,
    backgroundColor: Theme.colors.textSecondary,
    marginHorizontal: 6,
  },
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1, borderBottomColor: Theme.colors.border,
  },
  tabBtn: {
    flex: 1, alignItems: 'center', paddingVertical: 12, position: 'relative',
  },
  tabText: { fontSize: 14, color: Theme.colors.textSecondary },
  tabTextActive: { color: Theme.colors.primary, fontWeight: '600' as const },
  tabIndicator: {
    position: 'absolute', bottom: 0, left: '20%', right: '20%',
    height: 2, backgroundColor: Theme.colors.primary, borderRadius: 1,
  },
  busyBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 6, gap: 8, backgroundColor: Theme.colors.backgroundSecondary,
  },
  busyText: { fontSize: 12, color: Theme.colors.textSecondary },
  searchInput: {
    marginHorizontal: 16, marginVertical: 10,
    paddingHorizontal: 14, paddingVertical: 9,
    backgroundColor: Theme.colors.backgroundSecondary,
    borderRadius: 10, color: Theme.colors.text, fontSize: 15,
    borderWidth: 1, borderColor: Theme.colors.border,
  },
  trackRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Theme.colors.border,
    height: 64,
  },
  trackIcon: {
    width: 32, height: 32, borderRadius: 8,
    backgroundColor: Theme.colors.backgroundSecondary,
    alignItems: 'center', justifyContent: 'center',
    marginRight: 12,
  },
  trackInfo: { flex: 1 },
  trackTitle: { fontSize: 14, fontWeight: '500' as const, color: Theme.colors.text },
  trackArtist: { fontSize: 12, color: Theme.colors.textSecondary, marginTop: 2 },
  trackMeta: { alignItems: 'flex-end', gap: 2, minWidth: 44 },
  metaText: { fontSize: 12, color: Theme.colors.textSecondary },
  actionsRow: {
    flexDirection: 'row', gap: 10,
    paddingHorizontal: 16, paddingVertical: 10,
  },
  actionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 10,
    backgroundColor: Theme.colors.backgroundSecondary,
    borderRadius: 10, borderWidth: 1, borderColor: Theme.colors.border,
  },
  actionBtnText: { fontSize: 13, color: Theme.colors.text, fontWeight: '500' as const },
  playlistRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Theme.colors.border,
  },
  playlistIcon: {
    width: 38, height: 38, borderRadius: 10,
    backgroundColor: Theme.colors.backgroundSecondary,
    alignItems: 'center', justifyContent: 'center', marginRight: 12,
  },
  playlistInfo: { flex: 1 },
  playlistTitle: { fontSize: 15, fontWeight: '500' as const, color: Theme.colors.text },
  playlistMeta: { fontSize: 12, color: Theme.colors.textSecondary, marginTop: 2 },
  emptyText: {
    textAlign: 'center', color: Theme.colors.textSecondary,
    fontSize: 14, marginTop: 40, paddingHorizontal: 32,
  },
  sectionTitle: { fontSize: 13, fontWeight: '600' as const, color: Theme.colors.textSecondary, marginBottom: 10 },
  volumeCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Theme.colors.backgroundSecondary,
    borderRadius: 12, padding: 16, marginBottom: 12,
    borderWidth: 1, borderColor: Theme.colors.border,
  },
  volumeLabel: { fontSize: 15, fontWeight: '600' as const, color: Theme.colors.text },
  volumeDetails: { fontSize: 12, color: Theme.colors.textSecondary, marginTop: 2 },
  volBtn: {
    paddingHorizontal: 14, paddingVertical: 7,
    backgroundColor: Theme.colors.backgroundSecondary,
    borderRadius: 8, borderWidth: 1, borderColor: Theme.colors.border,
    alignItems: 'center',
  },
  volBtnText: { fontSize: 13, color: Theme.colors.text, fontWeight: '500' as const },
  rescanBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 12, marginTop: 4,
    borderRadius: 10, borderWidth: 1, borderColor: Theme.colors.border,
  },
  rescanBtnText: { fontSize: 14, color: Theme.colors.primary },
  deviceRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5 },
  deviceText: { fontSize: 14, color: Theme.colors.text },
});
