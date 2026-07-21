import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  ScrollView,
  SafeAreaView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import * as FileSystem from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Theme } from '../theme/AppTheme';

const STORAGE_KEY = '@dj_engine_selected_card';
const TARGET_TYPE_KEY = '@dj_engine_target_type';
const SAF_URIS_KEY = '@dj_engine_saf_uris';

type TargetType = 'sd' | 'usb' | null;

// Common Android external storage paths to probe (path + human label)
const CANDIDATE_VOLUMES: { path: string; label: string; type: 'internal' | 'sdcard' | 'usb' }[] = [
  { path: '/storage/emulated/0',        label: 'Interner Speicher',  type: 'internal' },
  { path: '/storage/sdcard0',           label: 'SD-Karte (sdcard0)', type: 'sdcard'   },
  { path: '/storage/sdcard1',           label: 'SD-Karte (sdcard1)', type: 'sdcard'   },
  { path: '/storage/extSdCard',         label: 'SD-Karte (ext)',     type: 'sdcard'   },
  { path: '/storage/external_sd',       label: 'SD-Karte (extern)',  type: 'sdcard'   },
  { path: '/mnt/sdcard',               label: 'SD-Karte (mnt)',     type: 'sdcard'   },
  { path: '/mnt/extSdCard',            label: 'SD-Karte (extmnt)',  type: 'sdcard'   },
  { path: '/mnt/media_rw/sdcard1',     label: 'SD-Karte (rw)',      type: 'sdcard'   },
  // USB OTG paths
  { path: '/storage/usb0',             label: 'USB-Stick (usb0)',   type: 'usb'      },
  { path: '/storage/usb1',             label: 'USB-Stick (usb1)',   type: 'usb'      },
  { path: '/storage/usbdisk',          label: 'USB-Stick',          type: 'usb'      },
  { path: '/storage/UsbDriveA',        label: 'USB-Stick A',        type: 'usb'      },
  { path: '/storage/UsbDriveB',        label: 'USB-Stick B',        type: 'usb'      },
  { path: '/mnt/usb_storage',          label: 'USB-Speicher',       type: 'usb'      },
  { path: '/mnt/usb',                  label: 'USB (mnt)',          type: 'usb'      },
  { path: '/mnt/media_rw/usb0',        label: 'USB (usb0/rw)',      type: 'usb'      },
  { path: '/mnt/media_rw/usb1',        label: 'USB (usb1/rw)',      type: 'usb'      },
  { path: '/mnt/media_rw/udisk0',      label: 'USB-Disk 0',         type: 'usb'      },
  { path: '/mnt/media_rw/udisk1',      label: 'USB-Disk 1',         type: 'usb'      },
];

// Converts a content:// URI to a /storage/VOLUME/path string, or null if not parseable
function extractFilePathFromContentUri(uri: string): string | null {
  try {
    if (!uri || !uri.startsWith('content://')) return null;
    const decoded = decodeURIComponent(uri);
    // Match both /tree/ID and /document/ID patterns
    const treeMatch = decoded.match(/\/tree\/([^\/]+)/);
    const docMatch = decoded.match(/\/document\/([^\/]+)/);
    const rawId = treeMatch ? treeMatch[1] : docMatch ? docMatch[1] : null;
    if (!rawId) return null;
    const colonIdx = rawId.indexOf(':');
    const volumeId = colonIdx > -1 ? rawId.substring(0, colonIdx) : rawId;
    const relPath = colonIdx > -1 ? rawId.substring(colonIdx + 1) : '';
    const base = volumeId === 'primary' ? '/storage/emulated/0' : '/storage/' + volumeId;
    return base + (relPath ? '/' + relPath : '');
  } catch {
    return null;
  }
}

// Engine DJ folder structure for Denon SC Live 4
const ENGINE_LIBRARY_FOLDER = 'Engine Library';
const ENGINE_DB_SUBFOLDER = 'Engine Library/Database2';
const ENGINE_DB_FILE = 'Engine Library/Database2/m.db';

interface StorageVolume {
  path: string;
  label: string;
  type: 'internal' | 'sdcard' | 'usb' | 'manual';
  accessible: boolean;
  hasEngineLibrary: boolean;
  hasDatabase: boolean;
  freeSpace?: number;
  totalSpace?: number;
  trackCount?: number;
}

// ─── Sub-components (hooks at top level, no hooks inside render fns) ─────────

const VolumeCard = ({
  volume,
  selected,
  onSelect,
  delay,
}: {
  volume: StorageVolume;
  selected: boolean;
  onSelect: () => void;
  delay: number;
}) => {
  const fade = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(24)).current;
  const pressScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 450, delay, useNativeDriver: true }),
      Animated.spring(translateY, { toValue: 0, delay, useNativeDriver: true }),
    ]).start();
  }, []);

  const handlePressIn = () =>
    Animated.spring(pressScale, { toValue: 0.97, useNativeDriver: true }).start();
  const handlePressOut = () =>
    Animated.spring(pressScale, { toValue: 1, useNativeDriver: true }).start();

  const borderColor = selected
    ? Theme.colors.primary
    : volume.hasDatabase
    ? '#509BF5' + '60'
    : Theme.colors.border;

  const iconColor = volume.hasDatabase
    ? '#509BF5'
    : volume.hasEngineLibrary
    ? '#F59E0B'
    : Theme.colors.textMuted;

  const iconName = volume.hasDatabase
    ? 'checkmark-circle'
    : volume.hasEngineLibrary
    ? 'warning'
    : 'disc-outline';

  const mediaIcon = volume.type === 'usb' ? 'logo-usb' : 'hardware-chip';

  return (
    <Animated.View
      style={[
        styles.volumeCard,
        { borderColor, opacity: fade, transform: [{ translateY }, { scale: pressScale }] },
        selected && styles.volumeCardSelected,
      ]}
    >
      <TouchableOpacity
        onPress={onSelect}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        activeOpacity={1}
        style={styles.volumeCardInner}
      >
        <View style={[styles.volumeIconWrap, { backgroundColor: iconColor + '22' }]}>
          <Ionicons name={mediaIcon as any} size={28} color={iconColor} />
        </View>

        <View style={styles.volumeInfo}>
          <View style={styles.volumeTitleRow}>
            <Text style={styles.volumeLabel}>{volume.label}</Text>
            {selected && (
              <View style={styles.activeBadge}>
                <Text style={styles.activeBadgeText}>AKTIV</Text>
              </View>
            )}
          </View>
          <Text style={styles.volumePath} numberOfLines={1}>
            {volume.path}
          </Text>

          <View style={styles.volumeTagsRow}>
            {volume.hasDatabase ? (
              <View style={[styles.tag, { backgroundColor: '#509BF5' + '22' }]}>
                <Ionicons name="checkmark-circle" size={11} color="#509BF5" />
                <Text style={[styles.tagText, { color: '#509BF5' }]}>Engine DB gefunden</Text>
              </View>
            ) : volume.hasEngineLibrary ? (
              <View style={[styles.tag, { backgroundColor: '#F59E0B22' }]}>
                <Ionicons name="warning" size={11} color="#F59E0B" />
                <Text style={[styles.tagText, { color: '#F59E0B' }]}>Kein Database2</Text>
              </View>
            ) : (
              <View style={[styles.tag, { backgroundColor: Theme.colors.surface }]}>
                <Ionicons name="close-circle-outline" size={11} color={Theme.colors.textMuted} />
                <Text style={[styles.tagText, { color: Theme.colors.textMuted }]}>
                  Keine Engine Library
                </Text>
              </View>
            )}

            {volume.trackCount !== undefined && volume.trackCount > 0 && (
              <View style={[styles.tag, { backgroundColor: Theme.colors.primary + '22' }]}>
                <Ionicons name="musical-notes" size={11} color={Theme.colors.primary} />
                <Text style={[styles.tagText, { color: Theme.colors.primary }]}>
                  {volume.trackCount} Tracks
                </Text>
              </View>
            )}
          </View>
        </View>

        <Ionicons
          name={selected ? 'checkmark-circle' : 'chevron-forward'}
          size={20}
          color={selected ? Theme.colors.primary : Theme.colors.textMuted}
        />
      </TouchableOpacity>
    </Animated.View>
  );
};

const InfoRow = ({
  icon,
  label,
  value,
  color,
}: {
  icon: string;
  label: string;
  value: string;
  color?: string;
}) => (
  <View style={styles.infoRow}>
    <View style={styles.infoRowLeft}>
      <Ionicons name={icon as any} size={15} color={color || Theme.colors.textMuted} />
      <Text style={styles.infoLabel}>{label}</Text>
    </View>
    <Text style={[styles.infoValue, color ? { color } : {}]}>{value}</Text>
  </View>
);

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function SDCardSelectorPage() {
  const navigation = useNavigation<any>();
  const headerFade = useRef(new Animated.Value(0)).current;
  const headerY = useRef(new Animated.Value(-16)).current;

  const [scanning, setScanning] = useState(false);
  const [volumes, setVolumes] = useState<StorageVolume[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedVolume, setSelectedVolume] = useState<StorageVolume | null>(null);
  const [manualPath, setManualPath] = useState<string | null>(null);
  const [scanDone, setScanDone] = useState(false);
  const [showDiag, setShowDiag] = useState(false);
  const [diagResults, setDiagResults] = useState<{ path: string; label: string; type: string; exists: boolean; hasLib: boolean; hasDb: boolean }[]>([]);
  const [targetType, setTargetType] = useState<TargetType>(null);
  const [safUris, setSafUris] = useState<string[]>([]);
  const requestSAFAccessRef = useRef<() => Promise<void>>();

  useEffect(() => {
    Animated.parallel([
      Animated.timing(headerFade, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.spring(headerY, { toValue: 0, useNativeDriver: true }),
    ]).start();

    // Load previously selected path, target type, and SAF URIs, then scan
    AsyncStorage.multiGet([STORAGE_KEY, TARGET_TYPE_KEY, SAF_URIS_KEY]).then(([[, storedPath], [, storedTarget], [, storedSaf]]) => {
      if (storedPath) setSelectedPath(storedPath);
      const tt = (storedTarget as TargetType) || null;
      setTargetType(tt);
      const uris: string[] = storedSaf ? JSON.parse(storedSaf) : [];
      setSafUris(uris);
      startScan(tt, uris);
    });
  }, []);

  const checkEngineStructure = useCallback(
    async (basePath: string): Promise<{ hasEngineLibrary: boolean; hasDatabase: boolean; trackCount: number }> => {
      try {
        const libUri = 'file://' + basePath + '/' + ENGINE_LIBRARY_FOLDER;
        const dbFolderUri = 'file://' + basePath + '/' + ENGINE_DB_SUBFOLDER;
        const dbFileUri = 'file://' + basePath + '/' + ENGINE_DB_FILE;

        const [libInfo, dbFolderInfo, dbFileInfo] = await Promise.all([
          FileSystem.getInfoAsync(libUri).catch(() => ({ exists: false })),
          FileSystem.getInfoAsync(dbFolderUri).catch(() => ({ exists: false })),
          FileSystem.getInfoAsync(dbFileUri).catch(() => ({ exists: false })),
        ]);

        // Try to count music files if library exists
        let trackCount = 0;
        if (libInfo.exists) {
          try {
            const musicUri = 'file://' + basePath + '/' + ENGINE_LIBRARY_FOLDER + '/Music';
            const musicInfo = await FileSystem.getInfoAsync(musicUri).catch(() => ({ exists: false }));
            if (musicInfo.exists) {
              const files = await FileSystem.readDirectoryAsync(musicUri).catch(() => []);
              trackCount = files.filter((f) =>
                /\.(mp3|flac|aif|aiff|wav|ogg|m4a|alac)$/i.test(f)
              ).length;
            }
          } catch {
            trackCount = 0;
          }
        }

        return {
          hasEngineLibrary: !!libInfo.exists,
          hasDatabase: !!dbFileInfo.exists,
          trackCount,
        };
      } catch {
        return { hasEngineLibrary: false, hasDatabase: false, trackCount: 0 };
      }
    },
    []
  );

  const probeVolume = useCallback(
    async (
      path: string,
      label: string,
      type: StorageVolume['type']
    ): Promise<StorageVolume | null> => {
      try {
        const info = await FileSystem.getInfoAsync('file://' + path);
        if (!info.exists) return null;

        const engineInfo = await checkEngineStructure(path);

        return {
          path,
          label,
          type,
          accessible: true,
          hasEngineLibrary: engineInfo.hasEngineLibrary,
          hasDatabase: engineInfo.hasDatabase,
          trackCount: engineInfo.trackCount,
        };
      } catch {
        return null;
      }
    },
    [checkEngineStructure]
  );

  const startScan = useCallback(async (tt?: TargetType, extraSafUris?: string[]) => {
    // Resolve effective target: prefer argument, fall back to state
    const effectiveTarget: TargetType = tt !== undefined ? tt : targetType;

    setScanning(true);
    setScanDone(false);
    setVolumes([]);
    setDiagResults([]);

    const found: StorageVolume[] = [];
    const diag: typeof diagResults = [];

    // Internal storage is always shown regardless of target
    const docDir = FileSystem.documentDirectory;
    if (docDir) {
      const docPath = docDir.replace('file://', '').replace(/\/$/, '');
      const engineInfo = await checkEngineStructure(docPath);
      found.push({
        path: docPath,
        label: 'App-Speicher',
        type: 'internal',
        accessible: true,
        hasEngineLibrary: engineInfo.hasEngineLibrary,
        hasDatabase: engineInfo.hasDatabase,
        trackCount: engineInfo.trackCount,
      });
    }

    // Dynamically discover UUID-based mount points (Samsung, LG, etc. use /storage/XXXX-XXXX)
    const dynamicCandidates: typeof CANDIDATE_VOLUMES = [];
    const dynamicRoots = ['/storage', '/mnt/media_rw'];
    for (const root of dynamicRoots) {
      try {
        const entries = await FileSystem.readDirectoryAsync('file://' + root).catch(() => []);
        for (const entry of entries) {
          if (entry === 'emulated' || entry === 'self') continue;
          const fullPath = root + '/' + entry;
          const alreadyKnown = CANDIDATE_VOLUMES.some((c) => c.path === fullPath);
          if (!alreadyKnown) {
            const lowerEntry = entry.toLowerCase();
            const type: 'sdcard' | 'usb' = lowerEntry.includes('usb') ? 'usb' : 'sdcard';
            dynamicCandidates.push({ path: fullPath, label: `Wechseldatenträger (${entry})`, type });
          }
        }
      } catch {
        // root not accessible
      }
    }

    // Filter candidates based on the sync target
    const allCandidates = [...CANDIDATE_VOLUMES, ...dynamicCandidates];
    const candidatesToProbe = effectiveTarget
      ? allCandidates.filter((v) => v.type === effectiveTarget)
      : allCandidates;

    // Probe filtered paths
    const probeResults = await Promise.all(
      candidatesToProbe.map(async (v) => {
        try {
          const info = await FileSystem.getInfoAsync('file://' + v.path);
          const exists = !!info.exists;
          let hasLib = false;
          let hasDb = false;
          if (exists) {
            const e = await checkEngineStructure(v.path);
            hasLib = e.hasEngineLibrary;
            hasDb = e.hasDatabase;
          }
          diag.push({ path: v.path, label: v.label, type: v.type, exists, hasLib, hasDb });
          if (exists) {
            return await probeVolume(v.path, v.label, v.type);
          }
          return null;
        } catch {
          diag.push({ path: v.path, label: v.label, type: v.type, exists: false, hasLib: false, hasDb: false });
          return null;
        }
      })
    );

    setDiagResults(diag);

    for (const result of probeResults) {
      if (result && !found.some((f) => f.path === result.path)) {
        found.push(result);
      }
    }

    // SAF-granted URIs (Android 11+ Scoped Storage)
    const currentSafUris = extraSafUris !== undefined ? extraSafUris : safUris;
    for (const safUri of currentSafUris) {
      try {
        // Check if SAF URI is accessible by listing its contents
        const entries = await FileSystem.StorageAccessFramework.readDirectoryAsync(safUri).catch(() => null);
        if (entries !== null) {
          // Look for Engine Library folder among entries
          const hasEngineLibraryEntry = entries.some((e) =>
            e.toLowerCase().includes('engine%20library') || e.toLowerCase().includes('engine library')
          );
          let hasDatabase = false;
          let trackCount = 0;
          if (hasEngineLibraryEntry) {
            // Try to find Database2/m.db
            try {
              const libEntries = await FileSystem.StorageAccessFramework.readDirectoryAsync(
                entries.find((e) => e.toLowerCase().includes('engine%20library') || e.toLowerCase().includes('engine library')) || ''
              ).catch(() => [] as string[]);
              const db2Entry = libEntries.find((e) => e.toLowerCase().includes('database2'));
              if (db2Entry) {
                const db2Entries = await FileSystem.StorageAccessFramework.readDirectoryAsync(db2Entry).catch(() => [] as string[]);
                hasDatabase = db2Entries.some((e) => e.toLowerCase().includes('m.db'));
              }
            } catch {
              // can't recurse
            }
          }
          const safLabel = 'SD/USB (Android-Zugriff)';
          if (!found.some((f) => f.path === safUri)) {
            found.push({
              path: safUri,
              label: safLabel,
              type: 'sdcard',
              accessible: true,
              hasEngineLibrary: hasEngineLibraryEntry,
              hasDatabase,
              trackCount,
            });
          }
        }
      } catch {
        // SAF URI no longer valid
      }
    }

    // Sort: DB found first, then Engine Library, then others
    found.sort((a, b) => {
      if (a.hasDatabase && !b.hasDatabase) return -1;
      if (!a.hasDatabase && b.hasDatabase) return 1;
      if (a.hasEngineLibrary && !b.hasEngineLibrary) return -1;
      if (!a.hasEngineLibrary && b.hasEngineLibrary) return 1;
      return 0;
    });

    setVolumes(found);
    setScanDone(true);
    setScanning(false);

    // Auto-select if previously stored path is found
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (stored) {
      const match = found.find((v) => v.path === stored);
      if (match) setSelectedVolume(match);
    } else if (found.length > 0 && found[0].hasDatabase) {
      // Auto-select best candidate
      setSelectedVolume(found[0]);
    }
  }, [checkEngineStructure, probeVolume, safUris]);

  const handleSelectVolume = useCallback(
    async (volume: StorageVolume) => {
      setSelectedVolume(volume);
      setSelectedPath(volume.path);
      await AsyncStorage.setItem(STORAGE_KEY, volume.path);
    },
    []
  );

  const handlePickFolder = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: false,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const uri = result.assets[0].uri;
        let dirPath = '';

        if (uri.startsWith('file://')) {
          dirPath = uri.replace('file://', '').split('/').slice(0, -1).join('/');
        } else if (uri.startsWith('content://')) {
          // Try to extract /storage/VOLUME/path from content URI
          const derived = extractFilePathFromContentUri(uri);
          if (derived) {
            // derived includes the filename; strip it to get the directory
            const lastSlash = derived.lastIndexOf('/');
            dirPath = lastSlash > 0 ? derived.substring(0, lastSlash) : derived;
          } else {
            Alert.alert(
              'Pfad nicht lesbar',
              'Bitte nutze den "SD-Karte / USB-Stick zugriff erlauben" Button oben, um direkten Zugriff auf externe Speicher zu gewähren.'
            );
            return;
          }
        } else {
          dirPath = uri.split('/').slice(0, -1).join('/');
        }

        const info = await FileSystem.getInfoAsync('file://' + dirPath).catch(() => ({ exists: false }));
        if (!info.exists) {
          // Android Scoped Storage blocks direct file:// access — open SAF directory picker instead
          Alert.alert(
            'Android-Zugriff erforderlich',
            'Auf diesem Gerät muss der Zugriff auf SD-Karte / USB-Stick einmalig über den Android-Dialog erlaubt werden. Tippe auf "Zugriff erlauben".',
            [
              { text: 'Zugriff erlauben', onPress: () => requestSAFAccessRef.current?.() },
              { text: 'Abbrechen', style: 'cancel' },
            ]
          );
          return;
        }

        const engineInfo = await checkEngineStructure(dirPath);
        const newVolume: StorageVolume = {
          path: dirPath,
          label: 'Manuell ausgewählt',
          type: 'manual',
          accessible: true,
          hasEngineLibrary: engineInfo.hasEngineLibrary,
          hasDatabase: engineInfo.hasDatabase,
          trackCount: engineInfo.trackCount,
        };

        setManualPath(dirPath);
        setVolumes((prev) => {
          const filtered = prev.filter((v) => v.label !== 'Manuell ausgewählt');
          return [newVolume, ...filtered];
        });
        await handleSelectVolume(newVolume);
      }
    } catch {
      Alert.alert('Fehler', 'Ordner konnte nicht geöffnet werden.');
    }
  }, [checkEngineStructure, handleSelectVolume]);

  const requestSAFAccess = useCallback(async () => {
    const safApi = (FileSystem as any).StorageAccessFramework;
    if (!safApi || typeof safApi.requestDirectoryPermissionsAsync !== 'function') {
      Alert.alert(
        'Alternativer Zugriff',
        'Bitte wähle eine Datei von deiner SD-Karte oder deinem USB-Stick aus, damit die App den Pfad erkennen kann.',
        [{ text: 'Datei wählen', onPress: handlePickFolder }, { text: 'Abbrechen', style: 'cancel' }]
      );
      return;
    }
    try {
      const result = await safApi.requestDirectoryPermissionsAsync();
      if (result.granted) {
        const contentUri = result.directoryUri as string;

        // Always store the SAF URI — the derived file path is NOT reliably readable
        // on Android 11+ even when getInfoAsync() says it "exists".
        const newUris = [...safUris.filter((u) => u !== contentUri), contentUri];
        setSafUris(newUris);
        await AsyncStorage.setItem(SAF_URIS_KEY, JSON.stringify(newUris));
        await AsyncStorage.setItem(STORAGE_KEY, contentUri);
        setSelectedPath(contentUri);

        const safVolume: StorageVolume = {
          path: contentUri,
          label: 'SD-Karte / USB (Android-Zugriff)',
          type: targetType === 'usb' ? 'usb' : 'sdcard',
          accessible: true,
          hasEngineLibrary: false,
          hasDatabase: false,
          trackCount: 0,
        };
        setSelectedVolume(safVolume);
        setVolumes((prev) => [safVolume, ...prev.filter((v) => v.path !== contentUri)]);
        startScan(targetType, newUris);
        Alert.alert(
          'Zugriff gewährt',
          'SD-Karte / USB-Stick verbunden. Du kannst jetzt Ordner durchsuchen und Playlists exportieren.'
        );
      } else {
        Alert.alert('Kein Zugriff', 'Zugriff wurde nicht gewährt. Tippe erneut und wähle den Stammordner der SD-Karte oder des USB-Sticks aus.');
      }
    } catch (e: any) {
      const msg = e?.message || '';
      if (msg.toLowerCase().includes('cancel')) return;
      Alert.alert(
        'Zugriff über Dateiauswahl',
        'Der direkte Ordnerzugriff ist auf diesem Gerät nicht verfügbar. Wähle stattdessen eine Datei von der SD-Karte aus.',
        [{ text: 'Datei wählen', onPress: handlePickFolder }, { text: 'Abbrechen', style: 'cancel' }]
      );
    }
  }, [safUris, targetType, startScan, handlePickFolder]);

  // Keep ref up-to-date so handlePickFolder can call requestSAFAccess without a circular dep
  useEffect(() => {
    requestSAFAccessRef.current = requestSAFAccess;
  }, [requestSAFAccess]);

  const handleConfirm = useCallback(async () => {
    if (!selectedVolume) return;
    await AsyncStorage.setItem(STORAGE_KEY, selectedVolume.path);
    Alert.alert(
      'Speichermedium verbunden',
      `${selectedVolume.label} wurde als aktives Medium gesetzt.\n\nPfad: ${selectedVolume.path}`,
      [{ text: 'OK', onPress: () => navigation.goBack() }]
    );
  }, [selectedVolume, navigation]);

  const dbVolume = selectedVolume || volumes.find((v) => v.hasDatabase);

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Header */}
      <Animated.View
        style={[styles.header, { opacity: headerFade, transform: [{ translateY: headerY }] }]}
      >
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={22} color={Theme.colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Speichermedium wählen</Text>
          <Text style={styles.headerSubtitle}>
            {targetType === 'sd' ? 'Nur SD-Karte' : targetType === 'usb' ? 'Nur USB-Stick' : 'SD-Karte / USB-Stick'}
          </Text>
        </View>
        <TouchableOpacity style={styles.scanBtn} onPress={() => startScan(targetType, safUris)} disabled={scanning}>
          {scanning ? (
            <ActivityIndicator size="small" color={Theme.colors.primary} />
          ) : (
            <Ionicons name="refresh" size={20} color={Theme.colors.primary} />
          )}
        </TouchableOpacity>
      </Animated.View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Status Banner */}
        <Animated.View style={[styles.statusBanner, { opacity: headerFade }]}>
          <View style={[styles.statusDot, { backgroundColor: selectedVolume ? Theme.colors.primary : '#666' }]} />
          <Text style={styles.statusText}>
            {selectedVolume
              ? `Verbunden: ${selectedVolume.label}`
              : scanning
              ? targetType === 'sd'
                ? 'Suche nach SD-Karte…'
                : targetType === 'usb'
                ? 'Suche nach USB-Stick…'
                : 'Suche nach SD-Karte und USB…'
              : 'Kein Speichermedium verbunden'}
          </Text>
        </Animated.View>

        {/* Selected Volume Detail */}
        {selectedVolume && (
          <Animated.View style={[styles.detailCard, { opacity: headerFade }]}>
            <View style={styles.detailHeader}>
              <Ionicons
                name={(selectedVolume.type === 'usb' ? 'logo-usb' : 'hardware-chip') as any}
                size={18}
                color="#509BF5"
              />
              <Text style={styles.detailTitle}>{selectedVolume.label}</Text>
            </View>
            <InfoRow
              icon="folder-open-outline"
              label="Pfad"
              value={selectedVolume.path.length > 32
                ? '…' + selectedVolume.path.slice(-30)
                : selectedVolume.path}
            />
            <InfoRow
              icon="library-outline"
              label="Engine Library"
              value={selectedVolume.hasEngineLibrary ? 'Vorhanden' : 'Nicht gefunden'}
              color={selectedVolume.hasEngineLibrary ? Theme.colors.primary : Theme.colors.textMuted}
            />
            <InfoRow
              icon="server-outline"
              label="Datenbank (m.db)"
              value={selectedVolume.hasDatabase ? 'Gefunden ✓' : 'Nicht gefunden'}
              color={selectedVolume.hasDatabase ? '#509BF5' : '#F59E0B'}
            />
            {selectedVolume.trackCount !== undefined && selectedVolume.trackCount > 0 && (
              <InfoRow
                icon="musical-notes-outline"
                label="Tracks (Music/)"
                value={`${selectedVolume.trackCount} Dateien`}
                color={Theme.colors.primary}
              />
            )}
          </Animated.View>
        )}

        {/* Storage Volumes */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Speichermedien</Text>
          <Text style={styles.sectionCount}>
            {scanning ? 'Scanne…' : `${volumes.length} gefunden`}
          </Text>
        </View>

        {scanning && volumes.length === 0 && (
          <View style={styles.scanningWrap}>
            <ActivityIndicator size="large" color={Theme.colors.primary} />
            <Text style={styles.scanningText}>
            {targetType === 'sd'
              ? 'Suche nach SD-Karte und Engine Library…'
              : targetType === 'usb'
              ? 'Suche nach USB-Stick und Engine Library…'
              : 'Suche nach SD-Karte, USB-Stick und Engine Library…'}
          </Text>
          </View>
        )}

        {scanDone && volumes.length === 0 && (
          <View style={styles.emptyWrap}>
            <Ionicons name="hardware-chip-outline" size={48} color={Theme.colors.textMuted} />
            <Text style={styles.emptyTitle}>Keine Medien gefunden</Text>
            <Text style={styles.emptyText}>
              {targetType === 'sd'
                ? 'Stelle sicher, dass die SD-Karte des Denon SC Live 4 eingesteckt ist.'
                : targetType === 'usb'
                ? 'Stelle sicher, dass der USB-Stick des Denon SC Live 4 verbunden ist.'
                : 'Stelle sicher, dass die SD-Karte oder der USB-Stick des Denon SC Live 4 verbunden ist.'}
            </Text>
          </View>
        )}

        {volumes.map((volume, i) => (
          <VolumeCard
            key={volume.path}
            volume={volume}
            selected={selectedVolume?.path === volume.path}
            onSelect={() => handleSelectVolume(volume)}
            delay={100 + i * 80}
          />
        ))}

        {/* Engine DJ Structure Guide */}
        <View style={styles.guideCard}>
          <View style={styles.guideHeader}>
            <Ionicons name="information-circle-outline" size={16} color="#509BF5" />
            <Text style={styles.guideTitle}>Denon Engine DJ Struktur</Text>
          </View>
          <View style={styles.guideTree}>
            <Text style={styles.guideTreeLine}>{'📁 SD-Karte  oder  🔌 USB-Stick/'}</Text>
            <Text style={styles.guideTreeLine}>{'  📁 Engine Library/'}</Text>
            <Text style={styles.guideTreeLine}>{'    📁 Database2/'}</Text>
            <Text style={[styles.guideTreeLine, { color: '#509BF5' }]}>
              {'      🗄  m.db   ← Hauptdatenbank'}
            </Text>
            <Text style={styles.guideTreeLine}>{'    📁 Music/'}</Text>
          </View>
        </View>

        {/* Diagnose */}
        {scanDone && (
          <TouchableOpacity
            style={[styles.diagToggleBtn, showDiag && styles.diagToggleBtnActive]}
            onPress={() => setShowDiag((v) => !v)}
          >
            <Ionicons name="bug-outline" size={16} color={showDiag ? '#509BF5' : Theme.colors.textMuted} />
            <Text style={[styles.diagToggleText, showDiag && { color: '#509BF5' }]}>
              {targetType === 'sd' ? 'SD-' : 'USB-'}Diagnose {showDiag ? 'ausblenden' : 'anzeigen'} (
              {diagResults.filter((d) => d.type === (targetType || 'usb')).length} Pfade geprüft)
            </Text>
          </TouchableOpacity>
        )}

        {showDiag && (
          <View style={styles.diagCard}>
            <View style={styles.guideHeader}>
              <Ionicons name="bug-outline" size={15} color="#509BF5" />
              <Text style={styles.guideTitle}>{targetType === 'sd' ? 'SD' : 'USB'}-Pfad Diagnose</Text>
            </View>
            {diagResults
              .filter((d) => d.type === (targetType || 'usb'))
              .map((d) => (
                <View key={d.path} style={styles.diagRow}>
                  <Ionicons
                    name={d.hasDb ? 'checkmark-circle' : d.hasLib ? 'warning' : d.exists ? 'folder-open-outline' : 'close-circle-outline'}
                    size={14}
                    color={d.hasDb ? '#22c55e' : d.hasLib ? '#F59E0B' : d.exists ? '#509BF5' : Theme.colors.textMuted}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.diagPath} numberOfLines={1}>{d.path}</Text>
                    <Text style={[styles.diagStatus, {
                      color: d.hasDb ? '#22c55e' : d.hasLib ? '#F59E0B' : d.exists ? '#509BF5' : Theme.colors.textMuted
                    }]}>
                      {d.hasDb ? 'Engine DB gefunden ✓' : d.hasLib ? 'Engine Library (kein m.db)' : d.exists ? 'Zugänglich (keine Library)' : 'Nicht gefunden'}
                    </Text>
                  </View>
                </View>
              ))}
            {diagResults.filter((d) => d.type === (targetType || 'usb') && d.exists).length === 0 && (
              <Text style={styles.diagNoneText}>
                {targetType === 'sd'
                  ? 'Kein SD-Pfad zugänglich. Stelle sicher, dass die SD-Karte eingesteckt ist, dann tippe auf "Aktualisieren".'
                  : 'Kein USB-Pfad zugänglich. Stelle sicher, dass der USB-Stick verbunden ist, dann tippe auf "Aktualisieren".'}
              </Text>
            )}
          </View>
        )}

        {/* SAF Access – required on Android 11+ / Samsung */}
        <TouchableOpacity style={styles.safBtn} onPress={requestSAFAccess} disabled={scanning}>
          <Ionicons name="shield-checkmark-outline" size={20} color="#fff" />
          <View style={{ flex: 1 }}>
            <Text style={styles.safBtnTitle}>SD-Karte / USB-Stick zugriff erlauben</Text>
            <Text style={styles.safBtnSub}>Für Samsung Galaxy & Android 11+ erforderlich</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color="#fff" />
        </TouchableOpacity>

        {/* Manual Picker */}
        <TouchableOpacity style={styles.manualPickerBtn} onPress={handlePickFolder}>
          <Ionicons name="folder-open-outline" size={20} color={Theme.colors.primary} />
          <Text style={styles.manualPickerText}>Ordner manuell auswählen</Text>
        </TouchableOpacity>

        {/* Confirm Button */}
        {selectedVolume && (
          <TouchableOpacity style={styles.confirmBtn} onPress={handleConfirm}>
            <Ionicons name="checkmark-circle" size={20} color="#000" />
            <Text style={styles.confirmBtnText}>Als aktives Medium setzen</Text>
          </TouchableOpacity>
        )}
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
  scanBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Theme.colors.primary + '15',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: Theme.spacing.lg,
    paddingBottom: 48,
    gap: Theme.spacing.md,
  },
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Theme.colors.card,
    borderRadius: Theme.borderRadius.md,
    padding: Theme.spacing.md,
    borderWidth: 1,
    borderColor: Theme.colors.border,
  },
  statusDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },
  statusText: {
    fontSize: Theme.typography.fontSize.sm,
    color: Theme.colors.text,
    fontWeight: Theme.typography.fontWeight.medium as any,
  },
  detailCard: {
    backgroundColor: Theme.colors.card,
    borderRadius: Theme.borderRadius.md,
    padding: Theme.spacing.md,
    borderWidth: 1,
    borderColor: '#509BF5' + '40',
    gap: Theme.spacing.sm,
    ...Theme.elevation.sm,
  },
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  detailTitle: {
    fontSize: Theme.typography.fontSize.md,
    fontWeight: Theme.typography.fontWeight.bold as any,
    color: Theme.colors.text,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  infoRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  infoLabel: {
    fontSize: Theme.typography.fontSize.sm,
    color: Theme.colors.textMuted,
  },
  infoValue: {
    fontSize: Theme.typography.fontSize.sm,
    color: Theme.colors.text,
    fontWeight: Theme.typography.fontWeight.medium as any,
    maxWidth: '60%',
    textAlign: 'right',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    fontSize: Theme.typography.fontSize.md,
    fontWeight: Theme.typography.fontWeight.bold as any,
    color: Theme.colors.text,
  },
  sectionCount: {
    fontSize: Theme.typography.fontSize.sm,
    color: Theme.colors.textMuted,
  },
  scanningWrap: {
    alignItems: 'center',
    paddingVertical: Theme.spacing.xl,
    gap: Theme.spacing.md,
  },
  scanningText: {
    fontSize: Theme.typography.fontSize.sm,
    color: Theme.colors.textMuted,
    textAlign: 'center',
  },
  emptyWrap: {
    alignItems: 'center',
    paddingVertical: Theme.spacing.xl,
    gap: Theme.spacing.sm,
  },
  emptyTitle: {
    fontSize: Theme.typography.fontSize.md,
    fontWeight: Theme.typography.fontWeight.semibold as any,
    color: Theme.colors.text,
    marginTop: Theme.spacing.sm,
  },
  emptyText: {
    fontSize: Theme.typography.fontSize.sm,
    color: Theme.colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
  volumeCard: {
    backgroundColor: Theme.colors.card,
    borderRadius: Theme.borderRadius.md,
    borderWidth: 1.5,
    ...Theme.elevation.sm,
    overflow: 'hidden',
  },
  volumeCardSelected: {
    backgroundColor: Theme.colors.primary + '0A',
  },
  volumeCardInner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Theme.spacing.md,
    gap: Theme.spacing.md,
  },
  volumeIconWrap: {
    width: 52,
    height: 52,
    borderRadius: Theme.borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  volumeInfo: {
    flex: 1,
    gap: 4,
  },
  volumeTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  volumeLabel: {
    fontSize: Theme.typography.fontSize.md,
    fontWeight: Theme.typography.fontWeight.semibold as any,
    color: Theme.colors.text,
  },
  activeBadge: {
    backgroundColor: Theme.colors.primary + '22',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  activeBadgeText: {
    fontSize: 9,
    fontWeight: Theme.typography.fontWeight.bold as any,
    color: Theme.colors.primary,
    letterSpacing: 0.5,
  },
  volumePath: {
    fontSize: Theme.typography.fontSize.xs,
    color: Theme.colors.textMuted,
    fontFamily: 'monospace' as any,
  },
  volumeTagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 2,
  },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  tagText: {
    fontSize: 10,
    fontWeight: Theme.typography.fontWeight.medium as any,
  },
  guideCard: {
    backgroundColor: Theme.colors.surface,
    borderRadius: Theme.borderRadius.md,
    padding: Theme.spacing.md,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    gap: Theme.spacing.sm,
  },
  guideHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  guideTitle: {
    fontSize: Theme.typography.fontSize.sm,
    fontWeight: Theme.typography.fontWeight.semibold as any,
    color: '#509BF5',
  },
  guideTree: {
    gap: 2,
  },
  guideTreeLine: {
    fontSize: 12,
    color: Theme.colors.textSecondary,
    fontFamily: 'monospace' as any,
    lineHeight: 20,
  },
  safBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Theme.spacing.sm,
    padding: Theme.spacing.md,
    borderRadius: Theme.borderRadius.md,
    backgroundColor: '#509BF5',
    ...Theme.elevation.sm,
  },
  safBtnTitle: {
    fontSize: Theme.typography.fontSize.md,
    fontWeight: Theme.typography.fontWeight.bold as any,
    color: '#fff',
  },
  safBtnSub: {
    fontSize: Theme.typography.fontSize.xs,
    color: 'rgba(255,255,255,0.8)',
    marginTop: 2,
  },
  manualPickerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Theme.spacing.sm,
    padding: Theme.spacing.md,
    borderRadius: Theme.borderRadius.md,
    borderWidth: 1.5,
    borderStyle: 'dashed' as any,
    borderColor: Theme.colors.primary + '60',
  },
  manualPickerText: {
    fontSize: Theme.typography.fontSize.md,
    color: Theme.colors.primary,
    fontWeight: Theme.typography.fontWeight.medium as any,
  },
  confirmBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Theme.spacing.sm,
    backgroundColor: Theme.colors.primary,
    borderRadius: Theme.borderRadius.md,
    padding: Theme.spacing.md,
    ...Theme.elevation.md,
  },
  confirmBtnText: {
    fontSize: Theme.typography.fontSize.md,
    fontWeight: Theme.typography.fontWeight.bold as any,
    color: '#000',
  },
  diagToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: Theme.spacing.sm,
    borderRadius: Theme.borderRadius.sm,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    backgroundColor: Theme.colors.surface,
  },
  diagToggleBtnActive: {
    borderColor: '#509BF5' + '60',
    backgroundColor: '#509BF5' + '10',
  },
  diagToggleText: {
    fontSize: Theme.typography.fontSize.sm,
    color: Theme.colors.textMuted,
    fontWeight: Theme.typography.fontWeight.medium as any,
  },
  diagCard: {
    backgroundColor: Theme.colors.surface,
    borderRadius: Theme.borderRadius.md,
    padding: Theme.spacing.md,
    borderWidth: 1,
    borderColor: '#509BF5' + '40',
    gap: 8,
  },
  diagRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: Theme.colors.border,
  },
  diagPath: {
    fontSize: 11,
    color: Theme.colors.text,
    fontFamily: 'monospace' as any,
  },
  diagStatus: {
    fontSize: 10,
    fontWeight: Theme.typography.fontWeight.medium as any,
    marginTop: 1,
  },
  diagNoneText: {
    fontSize: Theme.typography.fontSize.sm,
    color: Theme.colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
    paddingVertical: Theme.spacing.sm,
  },
});
