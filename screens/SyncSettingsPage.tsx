import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  ScrollView,
  SafeAreaView,
  Switch,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import { Theme } from '../theme/AppTheme';

const SD_STORAGE_KEY = '@dj_engine_selected_card';
const SETTINGS_KEY = '@dj_engine_sync_settings';
const TARGET_TYPE_KEY = '@dj_engine_target_type';
const ENGINE_DB_PATH = 'Engine Library/Database2/m.db';

type TargetType = 'sd' | 'usb';

interface SyncSettings {
  syncPlaylists: boolean;
  syncAnalysis: boolean;
  syncCamelotKeys: boolean;
  syncBeatgrid: boolean;
  autoSyncOnConnect: boolean;
  overwriteExisting: boolean;
}

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

const DEFAULT_SETTINGS: SyncSettings = {
  syncPlaylists: true,
  syncAnalysis: true,
  syncCamelotKeys: true,
  syncBeatgrid: false,
  autoSyncOnConnect: false,
  overwriteExisting: false,
};

// ─── Sub-components ────────────────────────────────────────────────────────────

const SettingRow = ({
  icon,
  iconColor,
  title,
  subtitle,
  value,
  onToggle,
  delay,
}: {
  icon: string;
  iconColor: string;
  title: string;
  subtitle: string;
  value: boolean;
  onToggle: (v: boolean) => void;
  delay: number;
}) => {
  const fade = useRef(new Animated.Value(0)).current;
  const tx = useRef(new Animated.Value(16)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 400, delay, useNativeDriver: true }),
      Animated.spring(tx, { toValue: 0, delay, useNativeDriver: true }),
    ]).start();
  }, []);

  return (
    <Animated.View style={[styles.settingRow, { opacity: fade, transform: [{ translateX: tx }] }]}>
      <View style={[styles.settingIconWrap, { backgroundColor: iconColor + '20' }]}>
        <Ionicons name={icon as any} size={20} color={iconColor} />
      </View>
      <View style={styles.settingText}>
        <Text style={styles.settingTitle}>{title}</Text>
        <Text style={styles.settingSubtitle}>{subtitle}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onToggle}
        trackColor={{ false: Theme.colors.surface, true: Theme.colors.primary + '80' }}
        thumbColor={value ? Theme.colors.primary : Theme.colors.textMuted}
      />
    </Animated.View>
  );
};

const TargetTypePicker = ({
  value,
  onChange,
}: {
  value: TargetType;
  onChange: (v: TargetType) => void;
}) => (
  <View style={pickerStyles.row}>
    {(['sd', 'usb'] as TargetType[]).map((type) => {
      const active = value === type;
      const icon = type === 'sd' ? 'hardware-chip' : 'logo-usb';
      const label = type === 'sd' ? 'SD-Karte' : 'USB-Stick';
      const accent = type === 'sd' ? Theme.colors.primary : '#F59E0B';
      return (
        <TouchableOpacity
          key={type}
          style={[pickerStyles.tile, active && { borderColor: accent, backgroundColor: accent + '18' }]}
          onPress={() => onChange(type)}
          activeOpacity={0.75}
        >
          <View style={[pickerStyles.iconWrap, { backgroundColor: accent + '20' }]}>
            <Ionicons name={icon as any} size={22} color={accent} />
          </View>
          <Text style={[pickerStyles.label, active && { color: accent }]}>{label}</Text>
          {active && (
            <View style={[pickerStyles.activeDot, { backgroundColor: accent }]} />
          )}
        </TouchableOpacity>
      );
    })}
  </View>
);

const pickerStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: Theme.spacing.sm,
  },
  tile: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Theme.spacing.md,
    borderRadius: Theme.borderRadius.md,
    borderWidth: 1.5,
    borderColor: Theme.colors.border,
    backgroundColor: Theme.colors.card,
    gap: Theme.spacing.xs,
    ...Theme.elevation.sm,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: Theme.typography.fontSize.sm,
    fontWeight: Theme.typography.fontWeight.semibold as any,
    color: Theme.colors.textMuted,
  },
  activeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 2,
  },
});

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function SyncSettingsPage() {
  const navigation = useNavigation<any>();
  const headerFade = useRef(new Animated.Value(0)).current;
  const headerY = useRef(new Animated.Value(-16)).current;

  const [sdPath, setSdPath] = useState<string | null>(null);
  const [dbExists, setDbExists] = useState(false);
  const [settings, setSettings] = useState<SyncSettings>(DEFAULT_SETTINGS);
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState('');
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [checkingDb, setCheckingDb] = useState(false);
  const [targetType, setTargetType] = useState<TargetType>('sd');

  useEffect(() => {
    Animated.parallel([
      Animated.timing(headerFade, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.spring(headerY, { toValue: 0, useNativeDriver: true }),
    ]).start();

    loadState();
  }, []);

  // Refresh when returning from SDCardSelector
  useEffect(() => {
    const unsub = navigation.addListener('focus', loadState);
    return unsub;
  }, [navigation]);

  const loadState = useCallback(async () => {
    const [path, rawSettings, rawLastSync, savedTargetType] = await Promise.all([
      AsyncStorage.getItem(SD_STORAGE_KEY),
      AsyncStorage.getItem(SETTINGS_KEY),
      AsyncStorage.getItem('@dj_engine_last_sync'),
      AsyncStorage.getItem(TARGET_TYPE_KEY),
    ]);

    if (path) {
      setSdPath(path);
      checkDb(path);
    }
    if (rawSettings) {
      try {
        setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(rawSettings) });
      } catch {}
    }
    if (rawLastSync) setLastSync(rawLastSync);
    if (savedTargetType === 'sd' || savedTargetType === 'usb') setTargetType(savedTargetType);
  }, []);

  const handleTargetTypeChange = useCallback(async (type: TargetType) => {
    setTargetType(type);
    await AsyncStorage.setItem(TARGET_TYPE_KEY, type);
  }, []);

  const checkDb = useCallback(async (path: string) => {
    setCheckingDb(true);
    try {
      if (path.startsWith('content://')) {
        const saf = (FileSystem as any).StorageAccessFramework;
        if (!saf || typeof saf.readDirectoryAsync !== 'function') { setDbExists(false); return; }
        const rootEntries: string[] = await saf.readDirectoryAsync(path).catch(() => []);
        const engineLibUri = rootEntries.find((e: string) =>
          decodeURIComponent(e).toLowerCase().includes('engine library')
        );
        if (!engineLibUri) { setDbExists(false); return; }
        const libEntries: string[] = await saf.readDirectoryAsync(engineLibUri).catch(() => []);
        const db2Uri = libEntries.find((e: string) =>
          decodeURIComponent(e).toLowerCase().includes('database2')
        );
        if (!db2Uri) { setDbExists(false); return; }
        const db2Entries: string[] = await saf.readDirectoryAsync(db2Uri).catch(() => []);
        const found = db2Entries.some((e: string) => {
          const decoded = decodeURIComponent(e).toLowerCase();
          return decoded.endsWith('/m.db') || decoded.endsWith(':m.db') || decoded.endsWith('m.db');
        });
        setDbExists(found);
      } else {
        const uri = 'file://' + path + '/' + ENGINE_DB_PATH;
        const info = await FileSystem.getInfoAsync(uri);
        setDbExists(!!info.exists);
      }
    } catch {
      setDbExists(false);
    } finally {
      setCheckingDb(false);
    }
  }, []);

  const updateSetting = useCallback(async (key: keyof SyncSettings, value: boolean) => {
    const updated = { ...settings, [key]: value };
    setSettings(updated);
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(updated));
  }, [settings]);

  const handleSync = useCallback(async () => {
    const mediumLabel = targetType === 'usb' ? 'USB-Stick' : 'SD-Karte';
    if (!sdPath) {
      Alert.alert(`${mediumLabel} fehlt`, `Bitte zuerst einen ${mediumLabel} verbinden.`);
      return;
    }
    setSyncing(true);
    let exportedCount = 0;

    try {
      if (!settings.syncPlaylists) {
        Alert.alert('Nichts zu synchronisieren', 'Bitte aktiviere mindestens "Playlists exportieren".');
        setSyncing(false);
        return;
      }

      {
        setSyncProgress('Lade Playlists…');
        const rawPlaylists = await AsyncStorage.getItem('@dj_playlists_v2');
        const playlists: Array<{ id: number; title: string; tracks: any[] }> =
          rawPlaylists ? JSON.parse(rawPlaylists) : [];

        if (sdPath.startsWith('content://')) {
          const saf = (FileSystem as any).StorageAccessFramework;
          if (!saf || typeof saf.readDirectoryAsync !== 'function') {
            throw new Error('StorageAccessFramework nicht verfügbar');
          }

          setSyncProgress('Suche Engine Library Ordner...');
          const rootEntries: string[] = await saf.readDirectoryAsync(sdPath).catch(() => []);
          let engineLibUri = rootEntries.find((e: string) =>
            decodeURIComponent(e).toLowerCase().includes('engine library')
          );
          if (!engineLibUri) {
            engineLibUri = await saf.makeDirectoryAsync(sdPath, 'Engine Library').catch(() => null);
            if (!engineLibUri) throw new Error('Engine Library Ordner konnte nicht erstellt werden');
          }

          setSyncProgress('Erstelle Playlist-Verzeichnis...');
          const libEntries: string[] = await saf.readDirectoryAsync(engineLibUri).catch(() => []);
          let playlistsDirUri = libEntries.find((e: string) =>
            decodeURIComponent(e).toLowerCase().includes('playlists')
          );
          if (!playlistsDirUri) {
            playlistsDirUri = await saf.makeDirectoryAsync(engineLibUri, 'Playlists').catch(() => null);
            if (!playlistsDirUri) throw new Error('Playlists Ordner konnte nicht erstellt werden');
          }

          for (let i = 0; i < playlists.length; i++) {
            const pl = playlists[i];
            setSyncProgress(`Exportiere Playlist ${i + 1}/${playlists.length}: "${pl.title}"…`);

            const tracks = (pl.tracks || []).slice().sort((a: any, b: any) => a.position - b.position);

            const safeTitle = pl.title.replace(/[/\\?%*:|"<>]/g, '_');
            const lines: string[] = ['#EXTM3U', `#PLAYLIST:${pl.title}`, ''];
            for (const t of tracks) {
              lines.push(`#EXTINF:-1,${t.artist || 'Unknown'} - ${t.title || 'Unknown'}`);
              if (settings.syncAnalysis && t.bpm) lines.push(`#EXT-X-BPM:${t.bpm}`);
              if (settings.syncCamelotKeys && t.key) lines.push(`#EXT-X-KEY-CAMELOT:${t.key}`);
              lines.push(t.path.startsWith('content://') ? safUriToFilePath(t.path) : t.path);
            }
            const m3u8Content = lines.join('\n');

            const dirEntries: string[] = await saf.readDirectoryAsync(playlistsDirUri).catch(() => []);
            const existingUri = dirEntries.find((e: string) => {
              const decoded = decodeURIComponent(e).toLowerCase();
              return decoded.includes(safeTitle.toLowerCase()) && decoded.endsWith('.m3u8');
            });

            if (existingUri) {
              if (settings.overwriteExisting) {
                await FileSystem.writeAsStringAsync(existingUri, m3u8Content, { encoding: FileSystem.EncodingType.UTF8 });
                exportedCount++;
              }
            } else {
              const fileUri = await saf.createFileAsync(playlistsDirUri, safeTitle + '.m3u8', 'audio/x-mpegurl');
              await FileSystem.writeAsStringAsync(fileUri, m3u8Content, { encoding: FileSystem.EncodingType.UTF8 });
              exportedCount++;
            }
          }
        } else {
          const playlistDir = 'file://' + sdPath + '/Engine Library/Playlists';
          const dirInfo = await FileSystem.getInfoAsync(playlistDir);
          if (!dirInfo.exists) {
            await FileSystem.makeDirectoryAsync(playlistDir, { intermediates: true });
          }

          for (let i = 0; i < playlists.length; i++) {
            const pl = playlists[i];
            setSyncProgress(`Exportiere Playlist ${i + 1}/${playlists.length}: "${pl.title}"…`);

            const tracks = (pl.tracks || []).slice().sort((a: any, b: any) => a.position - b.position);

            const safeTitle = pl.title.replace(/[/\\?%*:|"<>]/g, '_');
            const filePath = playlistDir + '/' + safeTitle + '.m3u8';
            const fileInfo = await FileSystem.getInfoAsync(filePath);

            if (!fileInfo.exists || settings.overwriteExisting) {
              const lines: string[] = ['#EXTM3U', `#PLAYLIST:${pl.title}`, ''];
              for (const t of tracks) {
                lines.push(`#EXTINF:-1,${t.artist || 'Unknown'} - ${t.title || 'Unknown'}`);
                if (settings.syncAnalysis && t.bpm) lines.push(`#EXT-X-BPM:${t.bpm}`);
                if (settings.syncCamelotKeys && t.key) lines.push(`#EXT-X-KEY-CAMELOT:${t.key}`);
                lines.push(t.path.startsWith('content://') ? safUriToFilePath(t.path) : t.path);
              }
              await FileSystem.writeAsStringAsync(filePath, lines.join('\n'), {
                encoding: FileSystem.EncodingType.UTF8,
              });
              exportedCount++;
            }
          }
        }
      }

      setSyncProgress('Sync abgeschlossen ✓');
      const now = new Date().toLocaleString('de-DE');
      setLastSync(now);
      await AsyncStorage.setItem('@dj_engine_last_sync', now);

      await new Promise((r) => setTimeout(r, 400));
      Alert.alert(
        'Sync erfolgreich',
        exportedCount > 0
          ? `${exportedCount} Playlist(s) als M3U8 auf den ${mediumLabel} exportiert.\n\nOrdner: Engine Library/Playlists/`
          : 'Alle Playlists sind bereits aktuell (kein Überschreiben aktiv).'
      );
    } catch (e: any) {
      Alert.alert(
        'Sync Fehler',
        `Synchronisierung fehlgeschlagen: ${e?.message || 'Unbekannter Fehler'}`
      );
    } finally {
      setSyncing(false);
      setSyncProgress('');
    }
  }, [sdPath, dbExists, settings, targetType]);

  const handleReset = useCallback(() => {
    Alert.alert(
      'Einstellungen zurücksetzen',
      'Alle Sync-Einstellungen auf Standard zurücksetzen?',
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Zurücksetzen',
          style: 'destructive',
          onPress: async () => {
            setSettings(DEFAULT_SETTINGS);
            await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(DEFAULT_SETTINGS));
          },
        },
      ]
    );
  }, []);

  const enabledCount = Object.values(settings).filter(Boolean).length;

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Header */}
      <Animated.View style={[styles.header, { opacity: headerFade, transform: [{ translateY: headerY }] }]}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={22} color={Theme.colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Sync-Einstellungen</Text>
          <Text style={styles.headerSubtitle}>Engine DJ · Denon SC Live 4</Text>
        </View>
        <TouchableOpacity style={styles.resetBtn} onPress={handleReset}>
          <Ionicons name="refresh-outline" size={20} color={Theme.colors.textMuted} />
        </TouchableOpacity>
      </Animated.View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Target Type Picker */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Sync-Ziel</Text>
          <TargetTypePicker value={targetType} onChange={handleTargetTypeChange} />
        </View>

        {/* Media Status */}
        <Animated.View style={[styles.sdCard, { opacity: headerFade }]}>
          <View style={styles.sdCardLeft}>
            <View style={[styles.sdIconWrap, { backgroundColor: sdPath ? (targetType === 'usb' ? '#F59E0B20' : Theme.colors.primary + '20') : '#F59E0B20' }]}>
              <Ionicons
                name={targetType === 'usb' ? 'logo-usb' : 'hardware-chip'}
                size={24}
                color={sdPath ? (targetType === 'usb' ? '#F59E0B' : Theme.colors.primary) : '#F59E0B'}
              />
            </View>
            <View>
              <Text style={styles.sdCardTitle}>
                {sdPath
                  ? (targetType === 'usb' ? 'USB-Stick verbunden' : 'SD-Karte verbunden')
                  : (targetType === 'usb' ? 'Kein USB-Stick' : 'Keine SD-Karte')}
              </Text>
              <Text style={styles.sdCardPath} numberOfLines={1}>
                {sdPath
                  ? sdPath.split('/').slice(-2).join('/')
                  : `Bitte ${targetType === 'usb' ? 'USB-Stick' : 'SD-Karte'} auswählen`}
              </Text>
              {sdPath && (
                checkingDb ? (
                  <ActivityIndicator size="small" color={Theme.colors.primary} style={{ marginTop: 4 }} />
                ) : (
                  <View style={styles.dbStatusRow}>
                    <View style={[styles.dbDot, { backgroundColor: dbExists ? Theme.colors.primary : '#F59E0B' }]} />
                    <Text style={[styles.dbStatusText, { color: dbExists ? Theme.colors.primary : '#F59E0B' }]}>
                      {dbExists ? 'Engine DB vorhanden' : 'Engine DB nicht gefunden'}
                    </Text>
                  </View>
                )
              )}
            </View>
          </View>
          <TouchableOpacity
            style={[styles.sdChangeBtn, targetType === 'usb' && { borderColor: '#F59E0B40', backgroundColor: '#F59E0B15' }]}
            onPress={() => navigation.navigate('SDCardSelector')}
          >
            <Text style={[styles.sdChangeBtnText, targetType === 'usb' && { color: '#F59E0B' }]}>
              {sdPath ? 'Ändern' : 'Verbinden'}
            </Text>
          </TouchableOpacity>
        </Animated.View>

        {/* Sync Now Button */}
        {(() => {
          const btnAccent = targetType === 'usb' ? '#F59E0B' : Theme.colors.primary;
          const active = !!(sdPath && !syncing);
          return (
            <TouchableOpacity
              style={[
                styles.syncBtn,
                { backgroundColor: btnAccent },
                (!sdPath || syncing) && styles.syncBtnDisabled,
              ]}
              onPress={handleSync}
              disabled={!sdPath || syncing}
            >
              {syncing ? (
                <>
                  <ActivityIndicator size="small" color="#000" />
                  <Text style={styles.syncBtnText} numberOfLines={1}>{syncProgress || 'Synchronisiere…'}</Text>
                </>
              ) : (
                <>
                  <Ionicons name="sync" size={20} color={active ? '#000' : Theme.colors.textMuted} />
                  <Text style={[styles.syncBtnText, !active && { color: Theme.colors.textMuted }]}>
                    Jetzt synchronisieren
                  </Text>
                </>
              )}
            </TouchableOpacity>
          );
        })()}

        {lastSync && (
          <Text style={styles.lastSync}>Letzter Sync: {lastSync}</Text>
        )}

        {/* Sync Options */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Sync-Optionen</Text>
          <View style={styles.settingsGroup}>
            <SettingRow
              icon="list"
              iconColor={Theme.colors.primary}
              title="Playlists exportieren"
              subtitle="Playlists ins Engine DJ Format schreiben"
              value={settings.syncPlaylists}
              onToggle={(v) => updateSetting('syncPlaylists', v)}
              delay={100}
            />
            <View style={styles.rowDivider} />
            <SettingRow
              icon="bar-chart"
              iconColor="#509BF5"
              title="Analysedaten"
              subtitle="BPM und Tonart-Daten synchronisieren"
              value={settings.syncAnalysis}
              onToggle={(v) => updateSetting('syncAnalysis', v)}
              delay={160}
            />
            <View style={styles.rowDivider} />
            <SettingRow
              icon="musical-note"
              iconColor="#B054F5"
              title="Camelot-Keys"
              subtitle="Harmonische Tonartnotation schreiben"
              value={settings.syncCamelotKeys}
              onToggle={(v) => updateSetting('syncCamelotKeys', v)}
              delay={220}
            />
            <View style={styles.rowDivider} />
            <SettingRow
              icon="grid"
              iconColor="#F59E0B"
              title="Beatgrid"
              subtitle="Beatgrid-Ankerpunkte übertragen"
              value={settings.syncBeatgrid}
              onToggle={(v) => updateSetting('syncBeatgrid', v)}
              delay={280}
            />
          </View>
        </View>

        {/* Advanced Options */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Erweitert</Text>
          <View style={styles.settingsGroup}>
            <SettingRow
              icon="flash"
              iconColor="#06B6D4"
              title="Auto-Sync bei Verbindung"
              subtitle={`Automatisch synchronisieren wenn ${targetType === 'usb' ? 'USB-Stick' : 'SD-Karte'} erkannt wird`}
              value={settings.autoSyncOnConnect}
              onToggle={(v) => updateSetting('autoSyncOnConnect', v)}
              delay={340}
            />
            <View style={styles.rowDivider} />
            <SettingRow
              icon="warning"
              iconColor="#EF4444"
              title="Bestehende Daten überschreiben"
              subtitle="Vorhandene Engine DJ Einträge ersetzen"
              value={settings.overwriteExisting}
              onToggle={(v) => updateSetting('overwriteExisting', v)}
              delay={400}
            />
          </View>
        </View>

        {/* Engine DJ Info */}
        <Animated.View style={[styles.infoCard, { opacity: headerFade }]}>
          <View style={styles.infoHeader}>
            <Ionicons name="information-circle-outline" size={16} color="#509BF5" />
            <Text style={styles.infoTitle}>Engine DJ Kompatibilität</Text>
          </View>
          <View style={styles.infoRow}>
            <View style={styles.infoItem}>
              <Text style={styles.infoLabel}>Format</Text>
              <Text style={styles.infoValue}>SQLite 3</Text>
            </View>
            <View style={styles.infoItem}>
              <Text style={styles.infoLabel}>Datenbank</Text>
              <Text style={styles.infoValue}>m.db</Text>
            </View>
            <View style={styles.infoItem}>
              <Text style={styles.infoLabel}>Optionen aktiv</Text>
              <Text style={[styles.infoValue, { color: Theme.colors.primary }]}>{enabledCount}</Text>
            </View>
          </View>
        </Animated.View>

        {/* Navigate to screens */}
        <View style={styles.linksGroup}>
          <TouchableOpacity style={styles.linkRow} onPress={() => navigation.navigate('AnalysisProgress')}>
            <View style={[styles.linkIcon, { backgroundColor: '#B054F520' }]}>
              <Ionicons name="analytics" size={20} color="#B054F5" />
            </View>
            <Text style={styles.linkText}>Analyse-Übersicht öffnen</Text>
            <Ionicons name="chevron-forward" size={16} color={Theme.colors.textMuted} />
          </TouchableOpacity>
          <View style={styles.rowDivider} />
          <TouchableOpacity style={styles.linkRow} onPress={() => navigation.navigate('PlaylistManager')}>
            <View style={[styles.linkIcon, { backgroundColor: Theme.colors.primary + '20' }]}>
              <Ionicons name="list" size={20} color={Theme.colors.primary} />
            </View>
            <Text style={styles.linkText}>Playlist-Manager öffnen</Text>
            <Ionicons name="chevron-forward" size={16} color={Theme.colors.textMuted} />
          </TouchableOpacity>
        </View>
      </ScrollView>
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
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Theme.colors.border,
    gap: Theme.spacing.sm,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Theme.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: Theme.typography.fontSize.lg,
    fontWeight: Theme.typography.fontWeight.bold as any,
    color: Theme.colors.text,
  },
  headerSubtitle: {
    fontSize: Theme.typography.fontSize.xs,
    color: Theme.colors.textMuted,
    marginTop: 1,
  },
  resetBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Theme.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: { flex: 1 },
  content: {
    padding: Theme.spacing.lg,
    paddingBottom: 48,
    gap: Theme.spacing.md,
  },
  sdCard: {
    backgroundColor: Theme.colors.card,
    borderRadius: Theme.borderRadius.md,
    padding: Theme.spacing.md,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Theme.spacing.md,
    ...Theme.elevation.sm,
  },
  sdCardLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Theme.spacing.md,
  },
  sdIconWrap: {
    width: 48,
    height: 48,
    borderRadius: Theme.borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sdCardTitle: {
    fontSize: Theme.typography.fontSize.md,
    fontWeight: Theme.typography.fontWeight.semibold as any,
    color: Theme.colors.text,
  },
  sdCardPath: {
    fontSize: Theme.typography.fontSize.xs,
    color: Theme.colors.textMuted,
    fontFamily: 'monospace' as any,
    marginTop: 2,
  },
  dbStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  dbDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  dbStatusText: {
    fontSize: 11,
    fontWeight: Theme.typography.fontWeight.medium as any,
  },
  sdChangeBtn: {
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
    borderRadius: Theme.borderRadius.sm,
    backgroundColor: Theme.colors.primary + '15',
    borderWidth: 1,
    borderColor: Theme.colors.primary + '40',
  },
  sdChangeBtnText: {
    fontSize: Theme.typography.fontSize.sm,
    color: Theme.colors.primary,
    fontWeight: Theme.typography.fontWeight.semibold as any,
  },
  syncBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Theme.spacing.sm,
    backgroundColor: Theme.colors.primary,
    borderRadius: Theme.borderRadius.md,
    padding: Theme.spacing.md,
    ...Theme.elevation.md,
  },
  syncBtnDisabled: {
    backgroundColor: Theme.colors.surface,
    borderWidth: 1,
    borderColor: Theme.colors.border,
  },
  syncBtnText: {
    fontSize: Theme.typography.fontSize.md,
    fontWeight: Theme.typography.fontWeight.bold as any,
    color: '#000',
    flexShrink: 1,
  },
  lastSync: {
    fontSize: Theme.typography.fontSize.xs,
    color: Theme.colors.textMuted,
    textAlign: 'center',
    marginTop: -4,
  },
  section: {
    gap: Theme.spacing.sm,
  },
  sectionTitle: {
    fontSize: Theme.typography.fontSize.sm,
    fontWeight: Theme.typography.fontWeight.semibold as any,
    color: Theme.colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    paddingHorizontal: 2,
  },
  settingsGroup: {
    backgroundColor: Theme.colors.card,
    borderRadius: Theme.borderRadius.md,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    overflow: 'hidden',
    ...Theme.elevation.sm,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.md,
    gap: Theme.spacing.md,
  },
  settingIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingText: {
    flex: 1,
  },
  settingTitle: {
    fontSize: Theme.typography.fontSize.md,
    fontWeight: Theme.typography.fontWeight.medium as any,
    color: Theme.colors.text,
  },
  settingSubtitle: {
    fontSize: Theme.typography.fontSize.xs,
    color: Theme.colors.textMuted,
    marginTop: 2,
    lineHeight: 16,
  },
  rowDivider: {
    height: 1,
    backgroundColor: Theme.colors.divider,
    marginHorizontal: Theme.spacing.md,
  },
  infoCard: {
    backgroundColor: Theme.colors.surface,
    borderRadius: Theme.borderRadius.md,
    padding: Theme.spacing.md,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    gap: Theme.spacing.md,
  },
  infoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  infoTitle: {
    fontSize: Theme.typography.fontSize.sm,
    fontWeight: Theme.typography.fontWeight.semibold as any,
    color: '#509BF5',
  },
  infoRow: {
    flexDirection: 'row',
  },
  infoItem: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  infoLabel: {
    fontSize: 10,
    color: Theme.colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  infoValue: {
    fontSize: Theme.typography.fontSize.md,
    fontWeight: Theme.typography.fontWeight.bold as any,
    color: Theme.colors.text,
  },
  linksGroup: {
    backgroundColor: Theme.colors.card,
    borderRadius: Theme.borderRadius.md,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    overflow: 'hidden',
    ...Theme.elevation.sm,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.md,
    gap: Theme.spacing.md,
  },
  linkIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkText: {
    flex: 1,
    fontSize: Theme.typography.fontSize.md,
    fontWeight: Theme.typography.fontWeight.medium as any,
    color: Theme.colors.text,
  },
});
