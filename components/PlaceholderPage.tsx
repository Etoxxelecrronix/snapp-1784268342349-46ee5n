import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppTheme } from '../theme/AppTheme';

interface PlaceholderPageProps {
  pageTitle: string;
  description?: string;
}

const PlaceholderPage: React.FC<PlaceholderPageProps> = ({ pageTitle, description }) => (
  <View style={styles.container}>
    <Ionicons name="construct-outline" size={56} color={AppTheme.colors.textMuted} />
    <Text style={styles.title}>{pageTitle}</Text>
    {description ? <Text style={styles.desc}>{description}</Text> : null}
  </View>
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: AppTheme.colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    gap: AppTheme.spacing.md,
    padding: AppTheme.spacing.xl,
  },
  title: {
    fontSize: AppTheme.typography.fontSize.xl,
    fontWeight: AppTheme.typography.fontWeight.semibold as any,
    color: AppTheme.colors.textSecondary,
    textAlign: 'center',
  },
  desc: {
    fontSize: AppTheme.typography.fontSize.sm,
    color: AppTheme.colors.textMuted,
    textAlign: 'center',
    lineHeight: 18,
  },
});

export default PlaceholderPage;
