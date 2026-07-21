import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import * as SQLite from 'expo-sqlite';
import { Theme } from '../theme/AppTheme';

const SD_STORAGE_KEY = '@dj_engine_selected_card';
const TARGET_TYPE_KEY = '@dj_engine_target_type';
const ENGINE_DB_PATH = 'Engine Library/Database2/m.db';

// Camelot key mapping (Engine DJ numeric key → Camelot notation)
const CAMELOT_MAP: Record<number, string> = {
  1: '8B', 2: '3B', 3: '10B', 4: '5B', 5: '12B', 6: '7B',
  7: '2B', 8: '9B', 9: '4B', 10: '11B', 11: '6B', 12: '1B',
  13: '8A', 14: '3A', 15: '10A', 16: '5A', 17: '12A', 18: '7A',
  19: '2A', 20: '9A', 21: '4A', 22: '11A', 23: '6A', 24: '1A',
};

interface TrackInfo {
  id: number;
  filename: string;
  bpm: number | null;
  key: number | null;
  duration: number | null;
  analysed: boolean;
}

type Phase = 'idle' | 'loading' | 'analysing' | 'done' | 'error';

// ─── Sub-components ───────────────────────────────────────────────────────────

const StatTile = ({
  value,
  label,
  color,
  delay,
}: {
  value: string;
  label: string;
  color: string;
  delay: number;
}) => {
  const fade = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.85)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 400, delay, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, delay, useNativeDriver: true }),
    ]).start();
  }, []);
  return (
    <Animated.View style={[styles.statTile, { opacity: fade, transform: [{ scale }] }]}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </Animated.View>
  );
};

const TrackRow = ({ track, index }: { track: TrackInfo; index: number }) => {
  const fade = useRef(new Animated.Value(0)).current;
  const tx = useRef(new Animated.Value(20)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 350, delay: index * 40, useNativeDriver: true }),
      Animated.timing(tx, { toValue: 0, duration: 350, delay: index * 40, useNativeDriver: true }),
    ]).start();
  }, []);

  const bpmStr = track.bpm && track.bpm > 0 ? track.bpm.toFixed(1) : '—';
  const keyStr = track.key && CAMELOT_MAP[track.key] ? CAMELOT_MAP[track.key] : '—';
  const isKey = track.key != null && CAMELOT_MAP[track.key] != null;
  const isBpm = track.bpm != null && track.bpm > 0;
  const fullyAnalysed = track.analysed && isBpm && isKey;

  return (
    <Animated.View style={[styles.trackRow, { opacity: fade, transform: [{ translateX: tx }] }]}>
      <View style={[styles.trackStatusDot, { backgroundColor: fullyAnalysed ? Theme.colors.primary : Theme.colors.warning }]} />
      <View style={styles.trackInfo}>
        <Text style={styles.trackName} numberOfLines={1}>
          {track.filename.replace(/\.[^.]+$/, '')}
        </Text>
        <Text style={styles.trackExt}>{track.filename.split('.').pop()?.toUpperCase() || ''}</Text>
      </View>
      <View style={styles.trackMeta}>
        <View style={[styles.metaBadge, { backgroundColor: isBpm ? Theme.colors.primary + '22' : Theme.colors.surface }]}>
          <Text style={[styles.metaText, { color: isBpm ? Theme.colors.primary : Theme.colors.textMuted }]}>
            {bpmStr}
          </Text>
          <Text style={styles.metaUnit}>{isBpm ? 'BPM' : ''}</Text>
        </View>
        <View style={[styles.metaBadge, { backgroundColor: isKey ? '#509BF522' : Theme.colors.surface }]}>
          <Text style={[styles.metaText, { color: isKey ? '#509BF5' : Theme.colors.textMuted }]}>
            {keyStr}
          </Text>
        </View>
      </View>
    </Animated.View>
  );
};

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AnalysisProgressPage() {
  const navigation = useNavigation<any>();
  const headerFade = useRef(new Animated.Value(0)).current;
  const headerY = useRef(new Animated.Value(-16)).current;

  const [phase, setPhase] = useState<Phase>('idle');
  const [tracks, setTracks] = useState<TrackInfo[]>([]);
  const [progress, setProgress] = useState(0);
  const [sdPath, setSdPath] = useState<string | null>(null);
  const [targetType, setTargetType] = useState<'sd' | 'usb' | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  const progressAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(headerFade, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.spring(headerY, { toValue: 0, useNativeDriver: true }),
    ]).start();

    Promise.all([
      AsyncStorage.getItem(SD_STORAGE_KEY),
      AsyncStorage.getItem(TARGET_TYPE_KEY),
    ]).then(([path, type]) => {
      if (path) setSdPath(path);
      if (type === 'sd' || type === 'usb') setTargetType(type);
    });
  }, []);

  // Refresh SD path and target type when returning from SDCardSelector
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      Promise.all([
        AsyncStorage.getItem(SD_STORAGE_KEY),
        AsyncStorage.getItem(TARGET_TYPE_KEY),
      ]).then(([path, type]) => {
        if (path) setSdPath(path);
        if (type === 'sd' || type === 'usb') setTargetType(type);
      });
    });
    return unsubscribe;
  }, [navigation]);

  useEffect(() => {
    Animated.timing(progressAnim, {
      toValue: progress,
      duration: 300,
      useNativeDriver: false,
    }).start();
  }, [progress]);

  const copyAndOpenDb = useCallback(async (basePath: string): Promise<SQLite.SQLiteDatabase | null> => {
    try {
      const sqliteDir = (FileSystem.documentDirectory || '') + 'SQLite/';
      const destUri = sqliteDir + 'm_engine.db';
      await FileSystem.makeDirectoryAsync(sqliteDir, { intermediates: true }).catch(() => {});

      let srcUri: string;

      if (basePath.startsWith('content://')) {
        // SAF (Android 11+ / Samsung) — traverse the directory tree via content URIs
        const saf = (FileSystem as any).StorageAccessFramework;
        if (!saf || typeof saf.readDirectoryAsync !== 'function') {
          throw new Error('StorageAccessFramework nicht verfügbar. Bitte Expo FileSystem-Version prüfen.');
        }

        const rootEntries: string[] = await saf.readDirectoryAsync(basePath).catch(() => []);
        const engineLibUri = rootEntries.find((e: string) =>
          decodeURIComponent(e).toLowerCase().includes('engine library') ||
          e.toLowerCase().includes('engine%20library') ||
          e.toLowerCase().includes('enginelibrary')
        );
        if (!engineLibUri) {
          throw new Error(`"Engine Library" Ordner nicht gefunden. Gefundene Ordner: ${rootEntries.map(e => decodeURIComponent(e).split('/').pop() || e).join(', ') || '(leer)'}`);
        }

        const libEntries: string[] = await saf.readDirectoryAsync(engineLibUri).catch(() => []);
        const db2Uri = libEntries.find((e: string) =>
          decodeURIComponent(e).toLowerCase().includes('database2')
        );
        if (!db2Uri) {
          throw new Error(`"Database2" Ordner nicht gefunden. Gefundene Ordner: ${libEntries.map(e => decodeURIComponent(e).split('/').pop() || e).join(', ') || '(leer)'}`);
        }

        const db2Entries: string[] = await saf.readDirectoryAsync(db2Uri).catch(() => []);
        const mdbUri = db2Entries.find((e: string) => {
          const decoded = decodeURIComponent(e).toLowerCase();
          return decoded.endsWith('/m.db') || decoded.endsWith(':m.db') || decoded.endsWith('m.db');
        });
        if (!mdbUri) {
          throw new Error(`"m.db" nicht gefunden. Dateien in Database2: ${db2Entries.map(e => decodeURIComponent(e).split('/').pop() || e).join(', ') || '(leer)'}`);
        }

        // SAF: read file as base64 and write to local storage
        // Try FileSystem.readAsStringAsync first (works with content:// in modern Expo),
        // fall back to saf.readAsStringAsync if the direct call fails.
        const enc = (FileSystem as any).EncodingType?.Base64 ?? 'base64';
        let base64: string;
        try {
          base64 = await FileSystem.readAsStringAsync(mdbUri, { encoding: enc });
        } catch {
          if (typeof saf.readAsStringAsync !== 'function') {
            throw new Error('Die Datei konnte nicht gelesen werden. Bitte Expo FileSystem auf eine neuere Version aktualisieren.');
          }
          base64 = await saf.readAsStringAsync(mdbUri, { encoding: enc });
        }
        await FileSystem.writeAsStringAsync(destUri, base64, { encoding: enc });
      } else {
        srcUri = 'file://' + basePath + '/' + ENGINE_DB_PATH;
        const srcInfo = await FileSystem.getInfoAsync(srcUri);
        if (!srcInfo.exists) return null;
        await FileSystem.copyAsync({ from: srcUri, to: destUri });
      }

      const db = await SQLite.openDatabaseAsync('m_engine.db');
      return db;
    } catch (e: any) {
      // Re-throw so the caller can show a specific error message
      throw e;
    }
  }, []);

  const loadTracks = useCallback(async () => {
    const mediaLabel = targetType === 'usb' ? 'USB-Stick' : 'SD-Karte';
    if (!sdPath) {
      setErrorMsg(`Kein ${mediaLabel} ausgewählt. Bitte zuerst einen ${mediaLabel} verbinden.`);
      setPhase('error');
      return;
    }

    setPhase('loading');
    setTracks([]);
    setProgress(0);
    setErrorMsg('');

    try {
      let db: SQLite.SQLiteDatabase | null = null;
      try {
        db = await copyAndOpenDb(sdPath);
      } catch (copyErr: any) {
        setErrorMsg(copyErr?.message || `Engine DJ Datenbank (m.db) nicht gefunden.\nBitte ${mediaLabel} auswählen und sicherstellen, dass eine Engine Library vorhanden ist.`);
        setPhase('error');
        return;
      }
      if (!db) {
        setErrorMsg(`Engine DJ Datenbank (m.db) nicht gefunden.\nBitte ${mediaLabel} auswählen und sicherstellen, dass eine Engine Library vorhanden ist.`);
        setPhase('error');
        return;
      }

      setPhase('analysing');

      let rows: TrackInfo[] = [];
      try {
        const result = await db.getAllAsync<any>(
          `SELECT id, filename, bpm, key, length, isAnalysed FROM Track ORDER BY filename LIMIT 500`
        );
        rows = result.map((r: any) => ({
          id: r.id ?? 0,
          filename: (r.filename || '').split('/').pop() || r.filename || 'Unbekannt',
          bpm: r.bpm != null ? parseFloat(r.bpm) : null,
          key: r.key != null ? parseInt(r.key, 10) : null,
          duration: r.length != null ? parseInt(r.length, 10) : null,
          analysed: !!r.isAnalysed,
        }));
      } catch {
        try {
          const result2 = await db.getAllAsync<any>(
            `SELECT id, path, bpmAnalyzed, keyAnalyzed, length, isAnalyzed FROM Track ORDER BY path LIMIT 500`
          );
          rows = result2.map((r: any) => ({
            id: r.id ?? 0,
            filename: (r.path || '').split('/').pop() || 'Unbekannt',
            bpm: r.bpmAnalyzed != null ? parseFloat(r.bpmAnalyzed) : null,
            key: r.keyAnalyzed != null ? parseInt(r.keyAnalyzed, 10) : null,
            duration: r.length != null ? parseInt(r.length, 10) : null,
            analysed: !!r.isAnalyzed,
          }));
        } catch {
          rows = [];
        }
      }

      await db.closeAsync().catch(() => {});

      if (rows.length === 0) {
        setErrorMsg('Keine Tracks in der Engine DJ Datenbank gefunden.\nBitte zuerst Tracks im Engine DJ Desktop hinzufügen.');
        setPhase('error');
        return;
      }

      for (let i = 0; i < rows.length; i++) {
        setTracks((prev) => [...prev, rows[i]]);
        setProgress(Math.round(((i + 1) / rows.length) * 100));
        if (i % 10 === 0) await new Promise((r) => setTimeout(r, 20));
      }

      setPhase('done');
    } catch (e: any) {
      setErrorMsg('Fehler beim Lesen der Datenbank: ' + (e?.message || 'Unbekannt'));
      setPhase('error');
    }
  }, [sdPath, copyAndOpenDb]);

  const analysedCount = tracks.filter((t) => t.analysed && t.bpm && t.bpm > 0).length;
  const needsAnalysis = tracks.length - analysedCount;
  const avgBpm =
    tracks.length > 0
      ? (tracks.reduce((s, t) => s + (t.bpm && t.bpm > 0 ? t.bpm : 0), 0) /
          Math.max(1, tracks.filter((t) => t.bpm && t.bpm > 0).length)).toFixed(1)
      : '—';

  const isUsb = targetType === 'usb';
  const mediaIcon: any = isUsb ? 'logo-usb' : 'hardware-chip';
  const mediaColor = isUsb ? Theme.colors.warning : Theme.colors.primary;
  const mediaLabel = isUsb ? 'USB-Stick' : 'SD-Karte';

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 100],
    outputRange: ['0%', '100%'],
  });

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Header */}
      <Animated.View style={[styles.header, { opacity: headerFade, transform: [{ translateY: headerY }] }]}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={22} color={Theme.colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Analyse</Text>
          <Text style={styles.headerSubtitle}>Engine DJ Datenbank</Text>
        </View>
        {phase === 'done' && (
          <TouchableOpacity style={styles.reloadBtn} onPress={loadTracks}>
            <Ionicons name="refresh" size={20} color={Theme.colors.primary} />
          </TouchableOpacity>
        )}
      </Animated.View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Media Status Banner */}
        <Animated.View style={[styles.sdBanner, { opacity: headerFade, borderColor: sdPath ? mediaColor + '40' : Theme.colors.border }]}>
          <Ionicons name={sdPath ? mediaIcon : 'alert-circle-outline'} size={16} color={sdPath ? mediaColor : Theme.colors.warning} />
          <Text style={styles.sdText} numberOfLines={1}>
            {sdPath ? sdPath.split('/').slice(-2).join('/') : `Kein ${mediaLabel} verbunden`}
          </Text>
          <TouchableOpacity onPress={() => navigation.navigate('SDCardSelector')}>
            <Text style={[styles.sdLink, { color: mediaColor }]}>{sdPath ? 'Ändern' : 'Verbinden'}</Text>
          </TouchableOpacity>
        </Animated.View>

        {/* Stats row (after done) */}
        {phase === 'done' && tracks.length > 0 && (
          <View style={styles.statsRow}>
            <StatTile value={String(tracks.length)} label="Tracks" color={Theme.colors.text} delay={0} />
            <StatTile value={String(analysedCount)} label="Analysiert" color={Theme.colors.primary} delay={80} />
            <StatTile value={avgBpm} label="Ø BPM" color="#509BF5" delay={160} />
            <StatTile value={String(needsAnalysis)} label="Ausstehend" color={needsAnalysis > 0 ? Theme.colors.warning : Theme.colors.textMuted} delay={240} />
          </View>
        )}

        {/* Progress bar (while analysing) */}
        {(phase === 'loading' || phase === 'analysing') && (
          <View style={styles.progressSection}>
            <View style={styles.progressHeader}>
              <Text style={styles.progressLabel}>
                {phase === 'loading' ? 'Datenbank wird geladen…' : `${tracks.length} Tracks gelesen`}
              </Text>
              <Text style={styles.progressPct}>{progress}%</Text>
            </View>
            <View style={styles.progressTrack}>
              <Animated.View style={[styles.progressFill, { width: progressWidth }]} />
            </View>
            {phase === 'analysing' && (
              <Text style={styles.progressSub}>
                BPM · Tonart · Beatgrid aus Engine DJ DB
              </Text>
            )}
          </View>
        )}

        {/* Start button (idle state) */}
        {phase === 'idle' && (
          <View style={styles.startSection}>
            <View style={[styles.startIconWrap, { backgroundColor: mediaColor + '15' }]}>
              <Ionicons name="analytics" size={56} color={mediaColor} />
            </View>
            <Text style={styles.startTitle}>Tracks analysieren</Text>
            <Text style={styles.startDesc}>
              {`Liest BPM, Tonart (Camelot) und Beatgrid-Daten aus der Engine DJ Datenbank auf dem ${mediaLabel}.`}
            </Text>
            <TouchableOpacity
              style={[styles.startBtn, !sdPath && styles.startBtnDisabled, sdPath && { backgroundColor: mediaColor }]}
              onPress={sdPath ? loadTracks : () => navigation.navigate('SDCardSelector')}
            >
              <Ionicons
                name={sdPath ? 'play-circle' : mediaIcon}
                size={20}
                color={sdPath ? '#000' : mediaColor}
              />
              <Text style={[styles.startBtnText, !sdPath && { color: mediaColor }]}>
                {sdPath ? 'Analyse starten' : `${mediaLabel} verbinden`}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Error state */}
        {phase === 'error' && (
          <View style={styles.errorCard}>
            <Ionicons name="warning" size={32} color={Theme.colors.warning} />
            <Text style={styles.errorTitle}>Analyse fehlgeschlagen</Text>
            <Text style={styles.errorMsg}>{errorMsg}</Text>
            <View style={styles.errorActions}>
              <TouchableOpacity style={styles.retryBtn} onPress={loadTracks}>
                <Text style={styles.retryBtnText}>Erneut versuchen</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.retryBtn, { borderColor: mediaColor + '60' }]}
                onPress={() => navigation.navigate('SDCardSelector')}
              >
                <Text style={[styles.retryBtnText, { color: mediaColor }]}>{`${mediaLabel} wählen`}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Loading spinner overlay on first load */}
        {phase === 'loading' && (
          <View style={styles.loadingCenter}>
            <ActivityIndicator size="large" color={Theme.colors.primary} />
            <Text style={styles.loadingText}>Datenbank wird kopiert…</Text>
          </View>
        )}

        {/* Track list */}
        {tracks.length > 0 && (
          <>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Tracks</Text>
              <View style={styles.legendRow}>
                <View style={[styles.legendDot, { backgroundColor: Theme.colors.primary }]} />
                <Text style={styles.legendText}>Analysiert</Text>
                <View style={[styles.legendDot, { backgroundColor: Theme.colors.warning, marginLeft: 8 }]} />
                <Text style={styles.legendText}>Ausstehend</Text>
              </View>
            </View>

            {tracks.map((track, i) => (
              <TrackRow key={track.id + '-' + i} track={track} index={i} />
            ))}

            {phase === 'analysing' && (
              <View style={styles.loadingMore}>
                <ActivityIndicator size="small" color={Theme.colors.primary} />
                <Text style={styles.loadingMoreText}>Weitere Tracks werden geladen…</Text>
              </View>
            )}
          </>
        )}

        {/* Info card about Engine DJ analysis */}
        {phase === 'idle' && (
          <View style={styles.infoCard}>
            <View style={styles.infoCardHeader}>
              <Ionicons name="information-circle-outline" size={16} color="#509BF5" />
              <Text style={styles.infoCardTitle}>Über Engine DJ Analyse</Text>
            </View>
            <Text style={styles.infoCardBody}>
              {`Engine DJ (Denon SC Live 4) führt BPM-Erkennung, Tonartanalyse und Beatgrid-Generierung durch und speichert die Ergebnisse in der m.db Datenbank auf dem ${mediaLabel}. Diese App liest die gespeicherten Analysedaten direkt aus der Datenbank.`}
            </Text>
            <View style={styles.infoFeatures}>
              <View style={styles.infoFeatureRow}>
                <Ionicons name="pulse" size={14} color={Theme.colors.primary} />
                <Text style={styles.infoFeatureText}>BPM-Präzision bis 0.1 BPM</Text>
              </View>
              <View style={styles.infoFeatureRow}>
                <Ionicons name="musical-note" size={14} color="#509BF5" />
                <Text style={styles.infoFeatureText}>24 Camelot-Tonarten</Text>
              </View>
              <View style={styles.infoFeatureRow}>
                <Ionicons name="grid" size={14} color="#F59E0B" />
                <Text style={styles.infoFeatureText}>Beatgrid mit Ankerpunkten</Text>
              </View>
            </View>
          </View>
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
  reloadBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Theme.colors.primary + '15',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: { flex: 1 },
  content: {
    padding: Theme.spacing.lg,
    paddingBottom: 48,
    gap: Theme.spacing.md,
  },
  sdBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Theme.colors.card,
    borderRadius: Theme.borderRadius.md,
    padding: Theme.spacing.md,
    borderWidth: 1,
    borderColor: Theme.colors.border,
  },
  sdDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  sdText: {
    flex: 1,
    fontSize: Theme.typography.fontSize.sm,
    color: Theme.colors.textSecondary,
    fontFamily: 'monospace' as any,
  },
  sdLink: {
    fontSize: Theme.typography.fontSize.sm,
    color: Theme.colors.primary,
    fontWeight: Theme.typography.fontWeight.semibold as any,
  },
  statsRow: {
    flexDirection: 'row',
    gap: Theme.spacing.sm,
  },
  statTile: {
    flex: 1,
    backgroundColor: Theme.colors.card,
    borderRadius: Theme.borderRadius.md,
    padding: Theme.spacing.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Theme.colors.border,
  },
  statValue: {
    fontSize: Theme.typography.fontSize.xxl,
    fontWeight: Theme.typography.fontWeight.bold as any,
  },
  statLabel: {
    fontSize: 10,
    color: Theme.colors.textMuted,
    marginTop: 2,
    textAlign: 'center',
  },
  progressSection: {
    backgroundColor: Theme.colors.card,
    borderRadius: Theme.borderRadius.md,
    padding: Theme.spacing.md,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    gap: Theme.spacing.sm,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progressLabel: {
    fontSize: Theme.typography.fontSize.sm,
    color: Theme.colors.text,
    fontWeight: Theme.typography.fontWeight.medium as any,
  },
  progressPct: {
    fontSize: Theme.typography.fontSize.sm,
    color: Theme.colors.primary,
    fontWeight: Theme.typography.fontWeight.bold as any,
  },
  progressTrack: {
    height: 6,
    backgroundColor: Theme.colors.surface,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: Theme.colors.primary,
    borderRadius: 3,
  },
  progressSub: {
    fontSize: 11,
    color: Theme.colors.textMuted,
    textAlign: 'center',
  },
  startSection: {
    alignItems: 'center',
    paddingVertical: Theme.spacing.xl,
    gap: Theme.spacing.md,
  },
  startIconWrap: {
    width: 96,
    height: 96,
    borderRadius: Theme.borderRadius.xl,
    backgroundColor: Theme.colors.primary + '15',
    alignItems: 'center',
    justifyContent: 'center',
  },
  startTitle: {
    fontSize: Theme.typography.fontSize.xl,
    fontWeight: Theme.typography.fontWeight.bold as any,
    color: Theme.colors.text,
  },
  startDesc: {
    fontSize: Theme.typography.fontSize.sm,
    color: Theme.colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: Theme.spacing.md,
  },
  startBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Theme.spacing.sm,
    backgroundColor: Theme.colors.primary,
    borderRadius: Theme.borderRadius.md,
    paddingHorizontal: Theme.spacing.xl,
    paddingVertical: Theme.spacing.md,
    marginTop: Theme.spacing.sm,
    ...Theme.elevation.md,
  },
  startBtnDisabled: {
    backgroundColor: Theme.colors.surface,
    borderWidth: 1.5,
    borderColor: Theme.colors.primary + '60',
  },
  startBtnText: {
    fontSize: Theme.typography.fontSize.md,
    fontWeight: Theme.typography.fontWeight.bold as any,
    color: '#000',
  },
  errorCard: {
    backgroundColor: Theme.colors.card,
    borderRadius: Theme.borderRadius.md,
    padding: Theme.spacing.lg,
    borderWidth: 1,
    borderColor: Theme.colors.warning + '40',
    alignItems: 'center',
    gap: Theme.spacing.sm,
  },
  errorTitle: {
    fontSize: Theme.typography.fontSize.md,
    fontWeight: Theme.typography.fontWeight.bold as any,
    color: Theme.colors.text,
    marginTop: 4,
  },
  errorMsg: {
    fontSize: Theme.typography.fontSize.sm,
    color: Theme.colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
  errorActions: {
    flexDirection: 'row',
    gap: Theme.spacing.sm,
    marginTop: 4,
  },
  retryBtn: {
    paddingHorizontal: Theme.spacing.lg,
    paddingVertical: Theme.spacing.sm,
    borderRadius: Theme.borderRadius.sm,
    backgroundColor: Theme.colors.surface,
    borderWidth: 1,
    borderColor: Theme.colors.border,
  },
  retryBtnText: {
    fontSize: Theme.typography.fontSize.sm,
    color: Theme.colors.text,
    fontWeight: Theme.typography.fontWeight.medium as any,
  },
  loadingCenter: {
    alignItems: 'center',
    paddingVertical: Theme.spacing.xl,
    gap: Theme.spacing.md,
  },
  loadingText: {
    fontSize: Theme.typography.fontSize.sm,
    color: Theme.colors.textMuted,
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
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  legendText: {
    fontSize: 10,
    color: Theme.colors.textMuted,
  },
  trackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Theme.colors.card,
    borderRadius: Theme.borderRadius.sm,
    padding: Theme.spacing.sm,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    gap: Theme.spacing.sm,
  },
  trackStatusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    flexShrink: 0,
  },
  trackInfo: {
    flex: 1,
    minWidth: 0,
  },
  trackName: {
    fontSize: Theme.typography.fontSize.sm,
    color: Theme.colors.text,
    fontWeight: Theme.typography.fontWeight.medium as any,
  },
  trackExt: {
    fontSize: 10,
    color: Theme.colors.textMuted,
    marginTop: 1,
  },
  trackMeta: {
    flexDirection: 'row',
    gap: 4,
    flexShrink: 0,
  },
  metaBadge: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 2,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
    minWidth: 44,
    justifyContent: 'center',
  },
  metaText: {
    fontSize: 11,
    fontWeight: Theme.typography.fontWeight.bold as any,
  },
  metaUnit: {
    fontSize: 9,
    color: Theme.colors.textMuted,
  },
  loadingMore: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Theme.spacing.sm,
    paddingVertical: Theme.spacing.md,
  },
  loadingMoreText: {
    fontSize: Theme.typography.fontSize.sm,
    color: Theme.colors.textMuted,
  },
  infoCard: {
    backgroundColor: Theme.colors.surface,
    borderRadius: Theme.borderRadius.md,
    padding: Theme.spacing.md,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    gap: Theme.spacing.sm,
  },
  infoCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  infoCardTitle: {
    fontSize: Theme.typography.fontSize.sm,
    fontWeight: Theme.typography.fontWeight.semibold as any,
    color: '#509BF5',
  },
  infoCardBody: {
    fontSize: Theme.typography.fontSize.sm,
    color: Theme.colors.textSecondary,
    lineHeight: 20,
  },
  infoFeatures: {
    gap: 6,
    marginTop: 4,
  },
  infoFeatureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  infoFeatureText: {
    fontSize: Theme.typography.fontSize.sm,
    color: Theme.colors.textSecondary,
  },
});
