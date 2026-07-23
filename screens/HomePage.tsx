import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  ScrollView,
  SafeAreaView,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Theme } from '../theme/AppTheme';
import { RootStackParamList } from '../App';
import { supabase } from '../supabase';
import AuthModal from '../components/AuthModal';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Home'>;

interface StatItem { label: string; value: string; icon: string; }
interface FolderItem { name: string; count: number; icon: string; color: string; }

const QUICK_ACTIONS = [
  {
    id: 'scan',
    title: 'Musik scannen',
    subtitle: 'SD-Karte / USB nach Tracks durchsuchen',
    icon: 'search',
    color: Theme.colors.primary,
    screen: 'FolderBrowser' as const,
  },
  {
    id: 'usb',
    title: 'USB-Stick',
    subtitle: 'USB-Stick verbinden & auswählen',
    icon: 'logo-usb',
    color: '#F59E0B',
    screen: 'SDCardSelector' as const,
  },
  {
    id: 'sdcard',
    title: 'Speichermedium',
    subtitle: 'SD-Karte oder USB-Stick auswählen',
    icon: 'hardware-chip',
    color: '#509BF5',
    screen: 'SDCardSelector' as const,
  },
  {
    id: 'analyse',
    title: 'Analyse starten',
    subtitle: 'BPM, Tonart & Beatgrid berechnen',
    icon: 'pulse',
    color: '#B054F5',
    screen: 'AnalysisProgress' as const,
  },
  {
    id: 'library',
    title: 'Bibliothek',
    subtitle: 'Tracks, Playlists & Gerätesync',
    icon: 'library',
    color: '#1DB954',
    screen: 'Library' as const,
  },
];

const FOLDER_COLORS = ['#1DB954', '#509BF5', '#B054F5', '#F59E0B', '#E91429', '#fa709a'];

const StatCard = ({ stat, delay }: { stat: StatItem; delay: number }) => {
  const fade = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 500, delay, useNativeDriver: true }),
      Animated.spring(translateY, { toValue: 0, delay, useNativeDriver: true }),
    ]).start();
  }, []);

  return (
    <Animated.View style={[styles.statCard, { opacity: fade, transform: [{ translateY }] }]}>
      <Ionicons name={stat.icon as any} size={20} color={Theme.colors.primary} />
      <Text style={styles.statValue}>{stat.value}</Text>
      <Text style={styles.statLabel}>{stat.label}</Text>
    </Animated.View>
  );
};

const ActionButton = ({
  action,
  delay,
  onPress,
}: {
  action: typeof QUICK_ACTIONS[0];
  delay: number;
  onPress: () => void;
}) => {
  const fade = useRef(new Animated.Value(0)).current;
  const translateX = useRef(new Animated.Value(-30)).current;
  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 500, delay, useNativeDriver: true }),
      Animated.spring(translateX, { toValue: 0, delay, useNativeDriver: true }),
    ]).start();
  }, []);

  const handlePressIn = () => {
    Animated.spring(scale, { toValue: 0.96, useNativeDriver: true }).start();
  };
  const handlePressOut = () => {
    Animated.spring(scale, { toValue: 1, useNativeDriver: true }).start();
  };

  return (
    <Animated.View style={{ opacity: fade, transform: [{ translateX }, { scale }] }}>
      <TouchableOpacity
        style={styles.actionButton}
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        activeOpacity={1}
      >
        <View style={[styles.actionIconWrap, { backgroundColor: action.color + '22' }]}>
          <Ionicons name={action.icon as any} size={26} color={action.color} />
        </View>
        <View style={styles.actionTextWrap}>
          <Text style={styles.actionTitle}>{action.title}</Text>
          <Text style={styles.actionSubtitle}>{action.subtitle}</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={Theme.colors.textMuted} />
      </TouchableOpacity>
    </Animated.View>
  );
};

const RecentFolder = ({ folder, delay, onPress }: { folder: FolderItem; delay: number; onPress: () => void }) => {
  const fade = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.9)).current;
  const pressScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 400, delay, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, delay, useNativeDriver: true }),
    ]).start();
  }, []);

  const handlePressIn = () => Animated.spring(pressScale, { toValue: 0.93, useNativeDriver: true }).start();
  const handlePressOut = () => Animated.spring(pressScale, { toValue: 1, useNativeDriver: true }).start();

  return (
    <Animated.View style={{ opacity: fade, transform: [{ scale }, { scale: pressScale }] }}>
      <TouchableOpacity
        style={styles.recentFolder}
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        activeOpacity={1}
      >
        <View style={[styles.recentFolderIcon, { backgroundColor: folder.color + '22' }]}>
          <Ionicons name="folder" size={22} color={folder.color} />
        </View>
        <Text style={styles.recentFolderName} numberOfLines={1}>{folder.name}</Text>
        <Text style={styles.recentFolderCount}>{folder.count}</Text>
      </TouchableOpacity>
    </Animated.View>
  );
};

export default function HomePage() {
  const navigation = useNavigation<Nav>();
  const headerFade = useRef(new Animated.Value(0)).current;
  const headerY = useRef(new Animated.Value(-20)).current;
  const [user, setUser] = useState<any>(null);
  const [showAuth, setShowAuth] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [stats, setStats] = useState<StatItem[]>([
    { label: 'Tracks', value: '—', icon: 'musical-notes' },
    { label: 'Playlists', value: '—', icon: 'list' },
    { label: 'Analysiert', value: '—', icon: 'bar-chart' },
  ]);
  const [recentFolders, setRecentFolders] = useState<FolderItem[]>([]);
  const [sdPath, setSdPath] = useState<string | null>(null);
  const [targetType, setTargetType] = useState<'sd' | 'usb'>('sd');

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setUser(data.session?.user ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) =>
      setUser(session?.user ?? null)
    );
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(headerFade, { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.spring(headerY, { toValue: 0, useNativeDriver: true }),
    ]).start();
  }, []);

  useFocusEffect(
    useCallback(() => {
      setIsLoading(true);
      loadStats();
      Promise.all([
        AsyncStorage.getItem('@dj_engine_selected_card'),
        AsyncStorage.getItem('@dj_engine_target_type'),
      ]).then(([path, tt]) => {
        setSdPath(path);
        if (tt === 'usb' || tt === 'sd') setTargetType(tt as 'sd' | 'usb');
      });
    }, [])
  );

  const loadStats = async () => {
    try {
      const raw = await AsyncStorage.getItem('@dj_playlists_v2');
      const playlists: Array<{ id: number; title: string; tracks: Array<{ bpm?: number | null; artist?: string }> }> =
        raw ? JSON.parse(raw) : [];

      const playlistCount = playlists.length;
      const allTracks = playlists.flatMap((p) => p.tracks);
      const trackCount = allTracks.length;
      const analyzedCount = allTracks.filter((t) => t.bpm != null && t.bpm > 0).length;
      const analyzedPct = trackCount > 0 ? Math.round((analyzedCount / trackCount) * 100) : 0;

      setStats([
        { label: 'Tracks', value: trackCount.toLocaleString('de-DE'), icon: 'musical-notes' },
        { label: 'Playlists', value: String(playlistCount), icon: 'list' },
        { label: 'Analysiert', value: `${analyzedPct}%`, icon: 'bar-chart' },
      ]);

      const artistCounts: Record<string, number> = {};
      for (const t of allTracks) {
        const a = (t as any).artist;
        if (a) artistCounts[a] = (artistCounts[a] ?? 0) + 1;
      }
      const topArtists = Object.entries(artistCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4);
      if (topArtists.length > 0) {
        setRecentFolders(
          topArtists.map(([name, count], i) => ({
            name,
            count,
            icon: 'folder',
            color: FOLDER_COLORS[i % FOLDER_COLORS.length],
          }))
        );
      }
    } catch {
      // keep default "—" state
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <Animated.View style={[styles.header, { opacity: headerFade, transform: [{ translateY: headerY }] }]}>
          <View style={styles.headerLeft}>
            <View style={styles.logoWrap}>
              <Ionicons name="disc" size={28} color={Theme.colors.primary} />
            </View>
            <View>
              <Text style={styles.appName}>DJ Engine</Text>
              <Text style={styles.appSubtitle}>Denon SC Live 4</Text>
            </View>
          </View>
          <View style={styles.headerRight}>
            <TouchableOpacity
              style={styles.authBtn}
              onPress={() => {
                if (user) {
                  supabase.auth.signOut();
                } else {
                  setShowAuth(true);
                }
              }}
            >
              <Ionicons
                name={user ? 'person' : 'person-outline'}
                size={20}
                color={user ? Theme.colors.primary : Theme.colors.textSecondary}
              />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.settingsBtn}
              onPress={() => navigation.navigate('SyncSettings')}
            >
              <Ionicons name="settings-outline" size={22} color={Theme.colors.textSecondary} />
            </TouchableOpacity>
          </View>
        </Animated.View>

        {/* Stats Row */}
        {isLoading ? (
          <View style={styles.statsLoadingRow}>
            <ActivityIndicator size="small" color={Theme.colors.primary} />
            <Text style={styles.statsLoadingText}>Aktualisiere...</Text>
          </View>
        ) : (
          <View style={styles.statsRow}>
            {stats.map((s, i) => (
              <StatCard key={s.label} stat={s} delay={200 + i * 100} />
            ))}
          </View>
        )}

        {/* SD Card / USB Status Banner */}
        {(() => {
          const accent = targetType === 'usb' ? '#F59E0B' : Theme.colors.primary;
          const mediumLabel = targetType === 'usb' ? 'USB-Stick' : 'SD-Karte';
          const iconName = targetType === 'usb' ? 'logo-usb' : 'hardware-chip-outline';
          return (
            <Animated.View style={[styles.sdBanner, { opacity: headerFade, borderColor: accent + '30', backgroundColor: accent + '15' }]}>
              <View style={styles.sdBannerLeft}>
                <Ionicons name={iconName as any} size={16} color={accent} />
                <Text style={[styles.sdBannerText, { color: Theme.colors.text }]}>
                  {sdPath ? `${mediumLabel} verbunden` : `Kein ${mediumLabel}`}
                </Text>
              </View>
              <TouchableOpacity onPress={() => navigation.navigate('SDCardSelector')}>
                <Text style={[styles.sdBannerAction, { color: accent }]}>{sdPath ? 'Wechseln' : 'Verbinden'}</Text>
              </TouchableOpacity>
            </Animated.View>
          );
        })()}

        {/* Auth Banner */}
        {user ? (
          <View style={styles.authBanner}>
            <Ionicons name="checkmark-circle" size={16} color="#16a34a" />
            <Text style={styles.authBannerText} numberOfLines={1}>
              {user.email}
            </Text>
            <TouchableOpacity onPress={() => supabase.auth.signOut()}>
              <Text style={styles.authBannerAction}>Abmelden</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity style={styles.authBannerLogin} onPress={() => setShowAuth(true)}>
            <Ionicons name="person-outline" size={16} color={Theme.colors.primary} />
            <Text style={styles.authBannerLoginText}>Anmelden / Registrieren</Text>
            <Ionicons name="chevron-forward" size={14} color={Theme.colors.primary} />
          </TouchableOpacity>
        )}

        {/* Quick Actions */}
        <Text style={styles.sectionTitle}>Schnellzugriff</Text>
        <View style={styles.actionsGroup}>
          {QUICK_ACTIONS.map((action, i) => (
            <ActionButton
              key={action.id}
              action={action}
              delay={400 + i * 80}
              onPress={() => {
                if (action.id === 'scan') {
                  navigation.navigate('FolderBrowser');
                } else if (action.id === 'sdcard' || action.id === 'usb') {
                  navigation.navigate('SDCardSelector');
                } else {
                  navigation.navigate('AnalysisProgress');
                }
              }}
            />
          ))}
        </View>

        {/* Recent Folders */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Ordner</Text>
          <TouchableOpacity onPress={() => navigation.navigate('FolderBrowser')}>
            <Text style={styles.seeAll}>Alle anzeigen</Text>
          </TouchableOpacity>
        </View>
        {recentFolders.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.recentScroll} contentContainerStyle={styles.recentContent}>
            {recentFolders.map((folder, i) => (
              <RecentFolder
                key={folder.name}
                folder={folder}
                delay={600 + i * 70}
                onPress={() => navigation.navigate('FolderBrowser', { folderName: folder.name })}
              />
            ))}
          </ScrollView>
        ) : (
          <Text style={styles.emptyFolders}>Keine Tracks importiert</Text>
        )}

        {/* Bottom Nav Strip */}
        <View style={styles.bottomNav}>
          <TouchableOpacity style={styles.bottomNavItem} onPress={() => navigation.navigate('PlaylistManager')}>
            <Ionicons name="list" size={22} color={Theme.colors.textMuted} />
            <Text style={styles.bottomNavLabel}>Playlists</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.bottomNavItem} onPress={() => navigation.navigate('AnalysisProgress')}>
            <Ionicons name="bar-chart" size={22} color={Theme.colors.textMuted} />
            <Text style={styles.bottomNavLabel}>Analyse</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.bottomNavItem} onPress={() => navigation.navigate('SyncSettings')}>
            <Ionicons name="sync" size={22} color={Theme.colors.textMuted} />
            <Text style={styles.bottomNavLabel}>Sync</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
      <AuthModal visible={showAuth} onClose={() => setShowAuth(false)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Theme.colors.background,
  },
  container: {
    flex: 1,
  },
  content: {
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Theme.spacing.lg,
    paddingTop: Theme.spacing.lg,
    paddingBottom: Theme.spacing.md,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Theme.spacing.sm,
  },
  logoWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: Theme.colors.primary + '22',
    alignItems: 'center',
    justifyContent: 'center',
    ...Theme.elevation.sm,
  },
  appName: {
    fontSize: Theme.typography.fontSize.xl,
    fontWeight: Theme.typography.fontWeight.bold as any,
    color: Theme.colors.text,
    letterSpacing: 0.5,
  },
  appSubtitle: {
    fontSize: Theme.typography.fontSize.sm,
    color: Theme.colors.textMuted,
    letterSpacing: 0.3,
  },
  settingsBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: Theme.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: Theme.spacing.lg,
    gap: Theme.spacing.sm,
    marginBottom: Theme.spacing.md,
  },
  statsLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Theme.spacing.lg,
    gap: Theme.spacing.sm,
    marginBottom: Theme.spacing.md,
    height: 74,
  },
  statsLoadingText: {
    fontSize: Theme.typography.fontSize.sm,
    color: Theme.colors.textMuted,
  },
  statCard: {
    flex: 1,
    backgroundColor: Theme.colors.card,
    borderRadius: Theme.borderRadius.md,
    padding: Theme.spacing.md,
    alignItems: 'center',
    gap: 4,
    ...Theme.elevation.sm,
    borderWidth: 1,
    borderColor: Theme.colors.border,
  },
  statValue: {
    fontSize: Theme.typography.fontSize.xl,
    fontWeight: Theme.typography.fontWeight.bold as any,
    color: Theme.colors.text,
  },
  statLabel: {
    fontSize: Theme.typography.fontSize.xs,
    color: Theme.colors.textMuted,
    textAlign: 'center',
  },
  sdBanner: {
    marginHorizontal: Theme.spacing.lg,
    marginBottom: Theme.spacing.lg,
    backgroundColor: Theme.colors.primary + '15',
    borderRadius: Theme.borderRadius.md,
    padding: Theme.spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: Theme.colors.primary + '30',
  },
  sdBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sdDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Theme.colors.primary,
  },
  sdBannerText: {
    fontSize: Theme.typography.fontSize.sm,
    color: Theme.colors.text,
    fontWeight: Theme.typography.fontWeight.medium as any,
  },
  sdBannerAction: {
    fontSize: Theme.typography.fontSize.sm,
    color: Theme.colors.primary,
    fontWeight: Theme.typography.fontWeight.semibold as any,
  },
  sectionTitle: {
    fontSize: Theme.typography.fontSize.lg,
    fontWeight: Theme.typography.fontWeight.bold as any,
    color: Theme.colors.text,
    paddingHorizontal: Theme.spacing.lg,
    marginBottom: Theme.spacing.sm,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: Theme.spacing.lg,
    marginTop: Theme.spacing.md,
    marginBottom: Theme.spacing.sm,
  },
  seeAll: {
    fontSize: Theme.typography.fontSize.sm,
    color: Theme.colors.primary,
    fontWeight: Theme.typography.fontWeight.medium as any,
  },
  actionsGroup: {
    marginHorizontal: Theme.spacing.lg,
    backgroundColor: Theme.colors.card,
    borderRadius: Theme.borderRadius.lg,
    overflow: 'hidden',
    ...Theme.elevation.md,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    marginBottom: Theme.spacing.md,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.md,
    gap: Theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Theme.colors.divider,
  },
  actionIconWrap: {
    width: 48,
    height: 48,
    borderRadius: Theme.borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionTextWrap: {
    flex: 1,
  },
  actionTitle: {
    fontSize: Theme.typography.fontSize.md,
    fontWeight: Theme.typography.fontWeight.semibold as any,
    color: Theme.colors.text,
    marginBottom: 2,
  },
  actionSubtitle: {
    fontSize: Theme.typography.fontSize.sm,
    color: Theme.colors.textMuted,
  },
  recentScroll: {
    flexGrow: 0,
  },
  recentContent: {
    paddingHorizontal: Theme.spacing.lg,
    gap: Theme.spacing.sm,
    alignItems: 'center',
  },
  recentFolder: {
    width: 120,
    backgroundColor: Theme.colors.card,
    borderRadius: Theme.borderRadius.md,
    padding: Theme.spacing.md,
    alignItems: 'center',
    gap: 8,
    ...Theme.elevation.sm,
    borderWidth: 1,
    borderColor: Theme.colors.border,
  },
  recentFolderIcon: {
    width: 44,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recentFolderName: {
    fontSize: Theme.typography.fontSize.sm,
    fontWeight: Theme.typography.fontWeight.semibold as any,
    color: Theme.colors.text,
    textAlign: 'center',
  },
  recentFolderCount: {
    fontSize: Theme.typography.fontSize.xs,
    color: Theme.colors.textMuted,
  },
  bottomNav: {
    flexDirection: 'row',
    marginHorizontal: Theme.spacing.lg,
    marginTop: Theme.spacing.xl,
    backgroundColor: Theme.colors.card,
    borderRadius: Theme.borderRadius.lg,
    padding: Theme.spacing.sm,
    ...Theme.elevation.md,
    borderWidth: 1,
    borderColor: Theme.colors.border,
  },
  bottomNavItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Theme.spacing.sm,
    gap: 4,
  },
  bottomNavLabel: {
    fontSize: Theme.typography.fontSize.xs,
    color: Theme.colors.textMuted,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Theme.spacing.xs,
  },
  authBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: Theme.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  authBanner: {
    marginHorizontal: Theme.spacing.lg,
    marginBottom: Theme.spacing.sm,
    backgroundColor: '#16a34a15',
    borderRadius: Theme.borderRadius.md,
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#16a34a30',
  },
  authBannerText: {
    flex: 1,
    fontSize: Theme.typography.fontSize.sm,
    color: Theme.colors.text,
    fontWeight: Theme.typography.fontWeight.medium as any,
  },
  authBannerAction: {
    fontSize: Theme.typography.fontSize.sm,
    color: '#dc2626',
    fontWeight: Theme.typography.fontWeight.semibold as any,
  },
  authBannerLogin: {
    marginHorizontal: Theme.spacing.lg,
    marginBottom: Theme.spacing.sm,
    backgroundColor: Theme.colors.primary + '12',
    borderRadius: Theme.borderRadius.md,
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: Theme.colors.primary + '30',
  },
  authBannerLoginText: {
    flex: 1,
    fontSize: Theme.typography.fontSize.sm,
    color: Theme.colors.primary,
    fontWeight: Theme.typography.fontWeight.medium as any,
  },
  emptyFolders: {
    paddingHorizontal: Theme.spacing.lg,
    paddingVertical: Theme.spacing.md,
    fontSize: Theme.typography.fontSize.sm,
    color: Theme.colors.textMuted,
  },
});
