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
import { Theme } from '../theme/AppTheme';
import { analysisQueue, QueueItem } from '../utils/AnalysisQueue';
import { AnalysisResult } from '../utils/AudioAnalyzer';
import { MUSIC_EXTENSIONS } from '../utils/MusicScanner';

const FOLDER_KEY = '@dj_engine_selected_card';

// ─── Waveform ─────────────────────────────────────────────────────────────────

const WaveformView = ({ waveform, source }: { waveform: number[]; source: string }) => {
  if (!waveform || waveform.length === 0) return null;
  const bars = 80;
  const step = Math.max(1, Math.floor(waveform.length / bars));
  const reduced: number[] = [];
  for (let i = 0; i < bars; i++) {
    const s = i * step;
    let max = 0;
    for (let j = s; j < Math.min(s + step, waveform.length); j++) {
      if (waveform[j] > max) max = waveform[j];
    }
    reduced.push(max);
  }
  const isPCM = source === 'pcm_wav' || source === 'pcm_aiff';
  return (
    <View style={wfStyles.container}>
      {reduced.map((v, i) => (
        <View
          key={i}
          style={[
            wfStyles.bar,
            {
              height: Math.max(2, v * 36),
              backgroundColor: isPCM ? Theme.colors.primary : Theme.colors.textMuted,
              opacity: 0.6 + v * 0.4,
            },
          ]}
        />
      ))}
    </View>
  );
};

const wfStyles = StyleSheet.create({
  container: { flexDirection: 'row', alignItems: 'center', height: 40, gap: 1, overflow: 'hidden' },
  bar: { width: 3, borderRadius: 1.5 },
});

// ─── Camelot Color ────────────────────────────────────────────────────────────

const CAMELOT_COLORS: Record<string, string> = {
  '1A':'#FF6B6B','2A':'#FF8E53','3A':'#FFA938','4A':'#FFD24C','5A':'#C8E05A',
  '6A':'#7EC850','7A':'#4DB87E','8A':'#37B5B5','9A':'#4B9EE8','10A':'#6B74D5',
  '11A':'#A64DC8','12A':'#D94D8E',
  '1B':'#FF9999','2B':'#FFB67A','3B':'#FFD066','4B':'#FFED80','5B':'#E2F080',
  '6B':'#A8E080','7B':'#70D0A8','8B':'#60D0D0','9B':'#80C0F8','10B':'#98A8F0',
  '11B':'#C890E8','12B':'#F090C0',
};

// ─── Track Card ───────────────────────────────────────────────────────────────

const TrackCard = ({ item, index }: { item: QueueItem; index: number }) => {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1, duration: 300, delay: Math.min(index, 20) * 30, useNativeDriver: true,
    }).start();
  }, []);

  const r: AnalysisResult | undefined = item.result;
  const isPCM = r && (r.analysisSource === 'pcm_wav' || r.analysisSource === 'pcm_aiff');
  const camelotColor = r?.camelotKey ? (CAMELOT_COLORS[r.camelotKey] || '#509BF5') : '#509BF5';

  const statusColor = item.status === 'done'
    ? Theme.colors.primary
    : item.status === 'error'
    ? Theme.colors.warning
    : item.status === 'analyzing'
    ? '#509BF5'
    : Theme.colors.textMuted;

  const ext = item.filename.split('.').pop()?.toUpperCase() || '';
  const name = item.filename.replace(/\.[^.]+$/, '');
  const progPct = Math.round(item.progress * 100);

  return (
    <Animated.View style={[cardStyles.card, { opacity: fadeAnim }]}>
      <TouchableOpacity
        activeOpacity={item.status === 'done' ? 0.7 : 1}
        onPress={() => item.status === 'done' && setExpanded(e => !e)}
      >
        {/* Row 1: status + name + meta */}
        <View style={cardStyles.row}>
          <View style={[cardStyles.dot, { backgroundColor: statusColor }]} />
          <View style={cardStyles.nameCol}>
            <Text style={cardStyles.name} numberOfLines={1}>{name}</Text>
            <Text style={cardStyles.ext}>{ext}</Text>
          </View>
          {item.status === 'done' && r && (
            <View style={cardStyles.badges}>
              {r.bpm > 0 && (
                <View style={[cardStyles.badge, { backgroundColor: Theme.colors.primary + '22' }]}>
                  <Text style={[cardStyles.badgeText, { color: Theme.colors.primary }]}>
                    {r.bpm.toFixed(1)}
                  </Text>
                  <Text style={cardStyles.badgeUnit}>BPM</Text>
                </View>
              )}
              {r.camelotKey && r.camelotKey !== '—' && (
                <View style={[cardStyles.badge, { backgroundColor: camelotColor + '22' }]}>
                  <Text style={[cardStyles.badgeText, { color: camelotColor }]}>{r.camelotKey}</Text>
                </View>
              )}
            </View>
          )}
          {item.status === 'analyzing' && (
            <Text style={cardStyles.progPct}>{progPct}%</Text>
          )}
          {item.status === 'queued' && (
            <Ionicons name="time-outline" size={14} color={Theme.colors.textMuted} />
          )}
          {item.status === 'error' && (
            <Ionicons name="warning-outline" size={14} color={Theme.colors.warning} />
          )}
          {item.status === 'done' && (
            <Ionicons
              name={expanded ? 'chevron-up' : 'chevron-down'}
              size={14}
              color={Theme.colors.textMuted}
            />
          )}
        </View>

        {/* Progress bar while analyzing */}
        {item.status === 'analyzing' && (
          <View style={cardStyles.progressTrack}>
            <View style={[cardStyles.progressFill, { width: `${progPct}%` }]} />
          </View>
        )}

        {/* Error message */}
        {item.status === 'error' && item.error && (
          <Text style={cardStyles.errorText} numberOfLines={1}>{item.error}</Text>
        )}
      </TouchableOpacity>

      {/* Expanded detail */}
      {expanded && r && item.status === 'done' && (
        <View style={cardStyles.detail}>
          {/* Waveform */}
          {r.waveform.length > 0 && (
            <View style={cardStyles.wfSection}>
              <WaveformView waveform={r.waveform} source={r.analysisSource} />
              {!isPCM && (
                <Text style={cardStyles.wfHint}>
                  Waveform geschätzt (komprimiertes Format)
                </Text>
              )}
            </View>
          )}

          {/* BPM + Tempo */}
          <View style={cardStyles.detailRow}>
            <DetailTile
              icon="pulse"
              label="BPM"
              value={r.bpm > 0 ? r.bpm.toFixed(2) : '—'}
              subtext={r.bpm > 0 ? `Konfidenz ${Math.round(r.bpmConfidence * 100)}%` : ''}
              color={Theme.colors.primary}
            />
            <DetailTile
              icon="speedometer"
              label="Stabilität"
              value={r.bpm > 0 ? `${Math.round(r.tempoStability * 100)}%` : '—'}
              subtext={r.bpm > 0 ? `${r.beatgrid.length} Beats` : ''}
              color="#F59E0B"
            />
          </View>

          {/* Key */}
          <View style={cardStyles.detailRow}>
            <DetailTile
              icon="musical-note"
              label="Tonart"
              value={r.musicalKey || '—'}
              subtext={r.musicalKey !== '—' ? `Konfidenz ${Math.round(r.keyConfidence * 100)}%` : ''}
              color={camelotColor}
            />
            <View style={cardStyles.keyBadges}>
              {r.camelotKey && r.camelotKey !== '—' && (
                <View style={[cardStyles.keyChip, { backgroundColor: camelotColor + '22', borderColor: camelotColor + '50' }]}>
                  <Text style={[cardStyles.keyChipLabel, { color: Theme.colors.textMuted }]}>Camelot</Text>
                  <Text style={[cardStyles.keyChipValue, { color: camelotColor }]}>{r.camelotKey}</Text>
                </View>
              )}
              {r.openKey && r.openKey !== '—' && (
                <View style={[cardStyles.keyChip, { backgroundColor: '#509BF522', borderColor: '#509BF550' }]}>
                  <Text style={[cardStyles.keyChipLabel, { color: Theme.colors.textMuted }]}>Open Key</Text>
                  <Text style={[cardStyles.keyChipValue, { color: '#509BF5' }]}>{r.openKey}</Text>
                </View>
              )}
            </View>
          </View>

          {/* Loudness */}
          <View style={cardStyles.detailRow}>
            <DetailTile
              icon="volume-high"
              label="LUFS"
              value={`${r.lufs} LUFS`}
              subtext="Integriert"
              color="#A78BFA"
            />
            <DetailTile
              icon="bar-chart"
              label="RMS / Peak"
              value={`${r.rms} dB`}
              subtext={`Peak ${r.peak} dB`}
              color="#34D399"
            />
          </View>

          {/* Source + duration */}
          <View style={cardStyles.metaRow}>
            <View style={cardStyles.sourceChip}>
              <Ionicons
                name={isPCM ? 'checkmark-circle' : 'information-circle'}
                size={11}
                color={isPCM ? Theme.colors.primary : Theme.colors.textMuted}
              />
              <Text style={[cardStyles.sourceText, { color: isPCM ? Theme.colors.primary : Theme.colors.textMuted }]}>
                {isPCM ? 'PCM analysiert' : 'Metadaten'}
              </Text>
            </View>
            {r.duration > 0 && (
              <Text style={cardStyles.durationText}>
                {Math.floor(r.duration / 60)}:{String(Math.floor(r.duration % 60)).padStart(2, '0')}
                {r.sampleRate > 0 ? ` · ${Math.round(r.sampleRate / 1000 * 10) / 10} kHz` : ''}
              </Text>
            )}
          </View>
        </View>
      )}
    </Animated.View>
  );
};

const DetailTile = ({ icon, label, value, subtext, color }: {
  icon: any; label: string; value: string; subtext: string; color: string;
}) => (
  <View style={[cardStyles.detailTile, { borderColor: color + '30' }]}>
    <View style={cardStyles.detailTileHeader}>
      <Ionicons name={icon} size={12} color={color} />
      <Text style={cardStyles.detailTileLabel}>{label}</Text>
    </View>
    <Text style={[cardStyles.detailTileValue, { color }]}>{value}</Text>
    {!!subtext && <Text style={cardStyles.detailTileSub}>{subtext}</Text>}
  </View>
);

const cardStyles = StyleSheet.create({
  card: {
    backgroundColor: Theme.colors.card,
    borderRadius: Theme.borderRadius.md,
    padding: Theme.spacing.sm,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    gap: 6,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 7, height: 7, borderRadius: 3.5, flexShrink: 0 },
  nameCol: { flex: 1, minWidth: 0 },
  name: { fontSize: 13, color: Theme.colors.text, fontWeight: '500' },
  ext: { fontSize: 10, color: Theme.colors.textMuted, marginTop: 1 },
  badges: { flexDirection: 'row', gap: 4 },
  badge: { flexDirection: 'row', alignItems: 'baseline', gap: 2, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  badgeUnit: { fontSize: 9, color: Theme.colors.textMuted },
  progPct: { fontSize: 11, color: '#509BF5', fontWeight: '600', minWidth: 28, textAlign: 'right' },
  progressTrack: { height: 3, backgroundColor: Theme.colors.surface, borderRadius: 2, overflow: 'hidden', marginTop: 2 },
  progressFill: { height: '100%', backgroundColor: '#509BF5', borderRadius: 2 },
  errorText: { fontSize: 11, color: Theme.colors.warning, marginTop: 2, paddingLeft: 15 },
  detail: { gap: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: Theme.colors.border },
  wfSection: { gap: 2 },
  wfHint: { fontSize: 10, color: Theme.colors.textMuted },
  detailRow: { flexDirection: 'row', gap: 8 },
  detailTile: { flex: 1, backgroundColor: Theme.colors.surface, borderRadius: 8, padding: 8, borderWidth: 1, gap: 2 },
  detailTileHeader: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  detailTileLabel: { fontSize: 10, color: Theme.colors.textMuted, fontWeight: '500' },
  detailTileValue: { fontSize: 13, fontWeight: '700' },
  detailTileSub: { fontSize: 10, color: Theme.colors.textMuted },
  keyBadges: { flex: 1, gap: 6 },
  keyChip: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1 },
  keyChipLabel: { fontSize: 10 },
  keyChipValue: { fontSize: 14, fontWeight: '800' },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sourceChip: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  sourceText: { fontSize: 10 },
  durationText: { fontSize: 10, color: Theme.colors.textMuted },
});

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AnalysisProgressPage() {
  const navigation = useNavigation<any>();
  const headerFade = useRef(new Animated.Value(0)).current;
  const headerY    = useRef(new Animated.Value(-16)).current;

  const [folderPath, setFolderPath]   = useState<string | null>(null);
  const [queueItems, setQueueItems]   = useState<QueueItem[]>([]);
  const [scanning, setScanning]       = useState(false);
  const [scanStatus, setScanStatus]   = useState('');

  // init queue
  useEffect(() => {
    analysisQueue.init().then(() => {
      const unsub = analysisQueue.subscribe(items => setQueueItems([...items]));
      return unsub;
    });
  }, []);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(headerFade, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.spring(headerY, { toValue: 0, useNativeDriver: true }),
    ]).start();
    AsyncStorage.getItem(FOLDER_KEY).then(p => { if (p) setFolderPath(p); });
  }, []);

  useEffect(() => {
    const unsub = navigation.addListener('focus', () => {
      AsyncStorage.getItem(FOLDER_KEY).then(p => { if (p) setFolderPath(p); });
    });
    return unsub;
  }, [navigation]);

  // ── Recursive scanner (simple, for analysis page) ───────────────────────────
  const collectTracks = useCallback(async (
    rootPath: string,
    found: { uri: string; filename: string }[],
    depth = 0,
  ): Promise<void> => {
    if (depth > 6) return;
    const isSAF = rootPath.startsWith('content://');
    try {
      let entries: string[] = [];
      if (isSAF) {
        const saf = (FileSystem as any).StorageAccessFramework;
        if (saf) entries = await saf.readDirectoryAsync(rootPath).catch(() => []);
      } else {
        const uri = rootPath.startsWith('file://') ? rootPath : 'file://' + rootPath;
        entries = await FileSystem.readDirectoryAsync(uri).catch(() => []);
      }

      for (const entry of entries) {
        const name = isSAF
          ? decodeURIComponent(entry).split(':').pop()?.split('/').pop() || ''
          : entry;
        if (!name || name.startsWith('.')) continue;

        if (MUSIC_EXTENSIONS.test(name)) {
          found.push({ uri: isSAF ? entry : (rootPath.replace(/\/?$/, '/') + name), filename: name });
          setScanStatus(`${found.length} Tracks gefunden…`);
          continue;
        }

        // recurse into subdirectories
        if (isSAF) {
          const saf = (FileSystem as any).StorageAccessFramework;
          const children = await saf?.readDirectoryAsync(entry).catch(() => null);
          if (children !== null) await collectTracks(entry, found, depth + 1);
        } else {
          const childPath = rootPath.replace(/\/?$/, '/') + name;
          const info = await FileSystem.getInfoAsync('file://' + childPath.replace('file://', '')).catch(() => null);
          if ((info as any)?.isDirectory) await collectTracks(childPath, found, depth + 1);
        }
      }
    } catch {}
  }, []);

  const startScan = useCallback(async () => {
    if (!folderPath || scanning) return;
    setScanning(true);
    setScanStatus('Scannen…');
    const found: { uri: string; filename: string }[] = [];
    await collectTracks(folderPath, found);
    setScanStatus(`${found.length} Tracks gefunden — Analyse startet…`);
    analysisQueue.enqueue(found);
    setScanning(false);
    setScanStatus('');
  }, [folderPath, scanning, collectTracks]);

  // ── Stats ───────────────────────────────────────────────────────────────────
  const total     = queueItems.length;
  const done      = queueItems.filter(q => q.status === 'done').length;
  const errors    = queueItems.filter(q => q.status === 'error').length;
  const analyzing = queueItems.filter(q => q.status === 'analyzing').length;
  const queued    = queueItems.filter(q => q.status === 'queued').length;

  const results   = queueItems.filter(q => q.result).map(q => q.result!);
  const bpmItems  = results.filter(r => r.bpm > 0);
  const avgBPM    = bpmItems.length > 0
    ? (bpmItems.reduce((s, r) => s + r.bpm, 0) / bpmItems.length).toFixed(1)
    : '—';
  const avgLUFS   = results.filter(r => r.lufs > -70).length > 0
    ? (results.filter(r => r.lufs > -70).reduce((s, r) => s + r.lufs, 0) / results.filter(r => r.lufs > -70).length).toFixed(1)
    : '—';

  const overallPct = total > 0 ? Math.round((done / total) * 100) : 0;
  const progAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(progAnim, { toValue: overallPct, duration: 300, useNativeDriver: false }).start();
  }, [overallPct]);
  const progWidth = progAnim.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] });

  const isWorking = analyzing > 0 || queued > 0;
  const folderLabel = folderPath ? folderPath.split('/').filter(Boolean).slice(-2).join('/') : null;

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <Animated.View style={[styles.header, { opacity: headerFade, transform: [{ translateY: headerY }] }]}>
        <TouchableOpacity style={styles.headerBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={22} color={Theme.colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Audioanalyse</Text>
          <Text style={styles.headerSub}>
            {isWorking ? `${analyzing} aktiv · ${queued} wartend` : done > 0 ? `${done} analysiert` : 'BPM · Tonart · Waveform · LUFS'}
          </Text>
        </View>
        {total > 0 && (
          <TouchableOpacity
            style={styles.headerBtn}
            onPress={() => { analysisQueue.clearQueue(); analysisQueue.clearResults(); }}
          >
            <Ionicons name="trash-outline" size={18} color={Theme.colors.warning} />
          </TouchableOpacity>
        )}
      </Animated.View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Folder banner */}
        <Animated.View style={[styles.folderBanner, { opacity: headerFade }]}>
          <Ionicons name={folderPath ? 'folder-open' : 'alert-circle-outline'} size={15} color={folderPath ? Theme.colors.primary : Theme.colors.warning} />
          <Text style={styles.folderText} numberOfLines={1}>
            {folderLabel || 'Kein Ordner ausgewählt'}
          </Text>
          <TouchableOpacity onPress={() => navigation.navigate('SDCardSelector')}>
            <Text style={styles.folderLink}>{folderPath ? 'Ändern' : 'Auswählen'}</Text>
          </TouchableOpacity>
        </Animated.View>

        {/* Overall progress */}
        {total > 0 && (
          <View style={styles.progressCard}>
            <View style={styles.progressHeader}>
              <Text style={styles.progressLabel}>
                {isWorking ? 'Analyse läuft…' : `Fertig · ${done}/${total} Tracks`}
              </Text>
              <Text style={styles.progressPct}>{overallPct}%</Text>
            </View>
            <View style={styles.progressTrack}>
              <Animated.View style={[styles.progressFill, { width: progWidth }]} />
            </View>
            {errors > 0 && (
              <Text style={styles.errorCount}>{errors} Fehler</Text>
            )}
          </View>
        )}

        {/* Stats tiles */}
        {done > 0 && (
          <View style={styles.statsRow}>
            <StatTile value={String(done)} label="Analysiert" color={Theme.colors.primary} delay={0} />
            <StatTile value={avgBPM} label="Ø BPM" color="#509BF5" delay={60} />
            <StatTile value={avgLUFS !== '—' ? `${avgLUFS}` : '—'} label="Ø LUFS" color="#A78BFA" delay={120} />
            <StatTile value={String(bpmItems.length)} label="BPM erkannt" color="#34D399" delay={180} />
          </View>
        )}

        {/* Start / idle */}
        {total === 0 && !scanning && (
          <View style={styles.startSection}>
            <View style={styles.startIcon}>
              <Ionicons name="analytics" size={52} color={Theme.colors.primary} />
            </View>
            <Text style={styles.startTitle}>Echte Audioanalyse</Text>
            <Text style={styles.startDesc}>
              {folderPath
                ? 'BPM, Beatgrid, Tonart (Camelot + Open Key) und LUFS/RMS werden direkt aus den Audiodaten berechnet.\nWAV und AIFF: vollständige PCM-Analyse.\nMP3/FLAC: gespeicherte Metadaten + Schätzwerte.'
                : 'Bitte zuerst einen Ordner auswählen.'}
            </Text>
            {folderPath && (
              <TouchableOpacity style={styles.startBtn} onPress={startScan}>
                <Ionicons name="scan" size={18} color="#000" />
                <Text style={styles.startBtnText}>Scannen & Analysieren</Text>
              </TouchableOpacity>
            )}
            {!folderPath && (
              <TouchableOpacity
                style={[styles.startBtn, { backgroundColor: Theme.colors.surface, borderWidth: 1.5, borderColor: Theme.colors.primary + '60' }]}
                onPress={() => navigation.navigate('SDCardSelector')}
              >
                <Ionicons name="folder-open-outline" size={18} color={Theme.colors.primary} />
                <Text style={[styles.startBtnText, { color: Theme.colors.primary }]}>Ordner wählen</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Scanning indicator */}
        {scanning && (
          <View style={styles.scanningCard}>
            <ActivityIndicator size="small" color={Theme.colors.primary} />
            <Text style={styles.scanningText}>{scanStatus || 'Ordner wird gescannt…'}</Text>
          </View>
        )}

        {/* Re-scan button when queue is empty but folder selected */}
        {total > 0 && !isWorking && !scanning && (
          <TouchableOpacity style={styles.rescanBtn} onPress={startScan}>
            <Ionicons name="refresh" size={15} color={Theme.colors.primary} />
            <Text style={styles.rescanText}>Erneut scannen</Text>
          </TouchableOpacity>
        )}

        {/* Track list */}
        {queueItems.length > 0 && (
          <View style={styles.trackList}>
            <Text style={styles.sectionTitle}>Tracks ({total})</Text>
            {queueItems.map((item, i) => (
              <TrackCard key={item.id} item={item} index={i} />
            ))}
          </View>
        )}

        {/* Info box */}
        {total === 0 && !scanning && (
          <View style={styles.infoBox}>
            <View style={styles.infoRow}>
              <Ionicons name="checkmark-circle" size={13} color={Theme.colors.primary} />
              <Text style={styles.infoText}><Text style={{ color: Theme.colors.primary }}>WAV / AIFF</Text>: Vollständige PCM-Analyse — BPM, Beatgrid, Downbeats, Tonart, LUFS, RMS, Waveform</Text>
            </View>
            <View style={styles.infoRow}>
              <Ionicons name="information-circle" size={13} color="#509BF5" />
              <Text style={styles.infoText}><Text style={{ color: '#509BF5' }}>MP3 / FLAC</Text>: ID3/Vorbis-Metadaten (BPM, Tonart wenn vorhanden) + Byte-Waveform</Text>
            </View>
            <View style={styles.infoRow}>
              <Ionicons name="layers" size={13} color="#A78BFA" />
              <Text style={styles.infoText}>Bis zu 3 Tracks gleichzeitig, UI bleibt responsiv</Text>
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── StatTile (extracted component, no hooks in parent render) ─────────────────

const StatTile = ({ value, label, color, delay }: { value: string; label: string; color: string; delay: number }) => {
  const fade  = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.85)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade,  { toValue: 1, duration: 350, delay, useNativeDriver: true }),
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

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Theme.colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: Theme.spacing.sm,
    paddingHorizontal: Theme.spacing.md, paddingVertical: Theme.spacing.md,
    borderBottomWidth: 1, borderBottomColor: Theme.colors.border,
  },
  headerBtn: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: Theme.colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { fontSize: Theme.typography.fontSize.lg, fontWeight: Theme.typography.fontWeight.bold as any, color: Theme.colors.text },
  headerSub: { fontSize: Theme.typography.fontSize.xs, color: Theme.colors.textMuted, marginTop: 1 },
  scroll: { flex: 1 },
  content: { padding: Theme.spacing.lg, paddingBottom: 48, gap: Theme.spacing.md },

  folderBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Theme.colors.card, borderRadius: Theme.borderRadius.md,
    padding: Theme.spacing.md, borderWidth: 1, borderColor: Theme.colors.border,
  },
  folderText: { flex: 1, fontSize: Theme.typography.fontSize.sm, color: Theme.colors.textSecondary, fontFamily: 'monospace' as any },
  folderLink: { fontSize: Theme.typography.fontSize.sm, color: Theme.colors.primary, fontWeight: Theme.typography.fontWeight.semibold as any },

  progressCard: {
    backgroundColor: Theme.colors.card, borderRadius: Theme.borderRadius.md,
    padding: Theme.spacing.md, borderWidth: 1, borderColor: Theme.colors.border, gap: 8,
  },
  progressHeader: { flexDirection: 'row', justifyContent: 'space-between' },
  progressLabel: { fontSize: Theme.typography.fontSize.sm, color: Theme.colors.text, fontWeight: Theme.typography.fontWeight.medium as any },
  progressPct: { fontSize: Theme.typography.fontSize.sm, color: Theme.colors.primary, fontWeight: Theme.typography.fontWeight.bold as any },
  progressTrack: { height: 5, backgroundColor: Theme.colors.surface, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: Theme.colors.primary, borderRadius: 3 },
  errorCount: { fontSize: 11, color: Theme.colors.warning },

  statsRow: { flexDirection: 'row', gap: Theme.spacing.sm },
  statTile: {
    flex: 1, backgroundColor: Theme.colors.card, borderRadius: Theme.borderRadius.md,
    padding: Theme.spacing.sm, alignItems: 'center', borderWidth: 1, borderColor: Theme.colors.border,
  },
  statValue: { fontSize: Theme.typography.fontSize.xl, fontWeight: Theme.typography.fontWeight.bold as any },
  statLabel: { fontSize: 9, color: Theme.colors.textMuted, marginTop: 2, textAlign: 'center' },

  startSection: { alignItems: 'center', paddingVertical: Theme.spacing.xl, gap: Theme.spacing.md },
  startIcon: {
    width: 88, height: 88, borderRadius: Theme.borderRadius.xl,
    backgroundColor: Theme.colors.primary + '18',
    alignItems: 'center', justifyContent: 'center',
  },
  startTitle: { fontSize: Theme.typography.fontSize.xl, fontWeight: Theme.typography.fontWeight.bold as any, color: Theme.colors.text },
  startDesc: {
    fontSize: Theme.typography.fontSize.sm, color: Theme.colors.textMuted,
    textAlign: 'center', lineHeight: 20, paddingHorizontal: Theme.spacing.md,
  },
  startBtn: {
    flexDirection: 'row', alignItems: 'center', gap: Theme.spacing.sm,
    backgroundColor: Theme.colors.primary, borderRadius: Theme.borderRadius.md,
    paddingHorizontal: Theme.spacing.xl, paddingVertical: Theme.spacing.md,
    marginTop: Theme.spacing.sm,
    ...Theme.elevation.md,
  },
  startBtnText: { fontSize: Theme.typography.fontSize.md, fontWeight: Theme.typography.fontWeight.bold as any, color: '#000' },

  scanningCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Theme.colors.card, borderRadius: Theme.borderRadius.md,
    padding: Theme.spacing.md, borderWidth: 1, borderColor: Theme.colors.border,
  },
  scanningText: { fontSize: Theme.typography.fontSize.sm, color: Theme.colors.textSecondary },

  rescanBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Theme.colors.surface, borderRadius: Theme.borderRadius.sm,
    paddingVertical: Theme.spacing.sm, borderWidth: 1, borderColor: Theme.colors.primary + '40',
  },
  rescanText: { fontSize: Theme.typography.fontSize.sm, color: Theme.colors.primary, fontWeight: Theme.typography.fontWeight.medium as any },

  trackList: { gap: 6 },
  sectionTitle: { fontSize: Theme.typography.fontSize.md, fontWeight: Theme.typography.fontWeight.bold as any, color: Theme.colors.text, marginBottom: 2 },

  infoBox: {
    backgroundColor: Theme.colors.surface, borderRadius: Theme.borderRadius.md,
    padding: Theme.spacing.md, borderWidth: 1, borderColor: Theme.colors.border, gap: 10,
  },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  infoText: { flex: 1, fontSize: 12, color: Theme.colors.textSecondary, lineHeight: 18 },
});
