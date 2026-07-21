import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppTheme } from '../theme/AppTheme';

// Type declaration for window with Snapp bridge
declare global {
  interface Window {
    __SNAPP_BRIDGE?: {
      postMessage: (message: any) => void;
    };
    ReactNativeWebView?: {
      postMessage: (message: string) => void;
    };
  }
}

interface PlaceholderPageProps {
  pageTitle: string;
  pageName: string;
  description?: string;
  suggestedPrompt?: string;
}

const PlaceholderPage: React.FC<PlaceholderPageProps> = ({
  pageTitle,
  pageName,
  description,
  suggestedPrompt
}) => {
  const handleCreatePage = () => {
    // Create detailed prompt with file context for AI
    const basePrompt = suggestedPrompt || `Add ${pageTitle} page to the app`;
    const capitalizedPageName = pageName.charAt(0).toUpperCase() + pageName.slice(1);
    const fileName = `screens/${capitalizedPageName}Page.tsx`;

    const message = `${basePrompt}

File to modify: ${fileName}
Current state: This file is using PlaceholderPage component and needs full implementation.
Action required: Replace the PlaceholderPage import and component with complete ${pageTitle} functionality.`;

    // Send message to parent Snapp app (iOS WebView or web builder)
    if (window?.__SNAPP_BRIDGE?.postMessage) {
      // Use Snapp bridge (injected by fullscreen preview page)
      window.__SNAPP_BRIDGE.postMessage({
        type: 'OPEN_CHAT_WITH_MESSAGE',
        message: message
      });
    } else if (window?.ReactNativeWebView) {
      // Fallback: Mobile - Send via React Native WebView (Android)
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'OPEN_CHAT_WITH_MESSAGE',
        message: message
      }));
    } else if (window.parent !== window) {
      // Fallback: Web - Send via iframe postMessage to parent
      window.parent.postMessage({
        type: 'OPEN_CHAT_WITH_MESSAGE',
        message: message
      }, '*');
    } 
  };

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        {/* Icon */}
        <View style={styles.iconContainer}>
          <Ionicons
            name="construct-outline"
            size={64}
            color={AppTheme.colors.primary}
          />
        </View>

        {/* Title */}
        <Text style={styles.title}>
          {pageTitle} Coming Soon
        </Text>

        {/* Description */}
        <Text style={styles.description}>
          {description || `The ${pageName} page is planned but not yet implemented.`}
        </Text>

        {/* Suggestion card */}
        <View style={styles.suggestionCard}>
          <Ionicons
            name="bulb-outline"
            size={24}
            color={AppTheme.colors.warning}
            style={styles.bulbIcon}
          />
          <View style={styles.suggestionContent}>
            <Text style={styles.suggestionTitle}>
              Want to add this page?
            </Text>
            <Text style={styles.suggestionText}>
              {suggestedPrompt || `Chat: "Add ${pageName} page"`}
            </Text>
          </View>
        </View>

        {/* Create Button */}
        <TouchableOpacity
          style={styles.createButton}
          onPress={handleCreatePage}
          activeOpacity={0.8}
        >
          <Ionicons
            name="chatbubbles"
            size={20}
            color="#FFFFFF"
            style={styles.buttonIcon}
          />
          <Text style={styles.buttonText}>Create This Page</Text>
        </TouchableOpacity>

        {/* Features */}
        <View style={styles.features}>
          <View style={styles.featureItem}>
            <Ionicons
              name="checkmark-circle"
              size={20}
              color={AppTheme.colors.success}
            />
            <Text style={styles.featureText}>Planned in schema</Text>
          </View>
          <View style={styles.featureItem}>
            <Ionicons
              name="rocket"
              size={20}
              color={AppTheme.colors.primary}
            />
            <Text style={styles.featureText}>Quick to add via chat</Text>
          </View>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: AppTheme.colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    padding: AppTheme.spacing.xl,
  },
  content: {
    alignItems: 'center',
    maxWidth: 400,
  },
  iconContainer: {
    width: 120,
    height: 120,
    borderRadius: AppTheme.borderRadius.full,
    backgroundColor: AppTheme.colors.primary + '10',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: AppTheme.spacing.xl,
  },
  title: {
    fontSize: AppTheme.typography.fontSize.heading,
    fontWeight: AppTheme.typography.fontWeight.bold,
    color: AppTheme.colors.text,
    textAlign: 'center',
    marginBottom: AppTheme.spacing.md,
  },
  description: {
    fontSize: AppTheme.typography.fontSize.lg,
    color: AppTheme.colors.textSecondary,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: AppTheme.spacing.xl,
  },
  suggestionCard: {
    flexDirection: 'row',
    backgroundColor: AppTheme.colors.warning + '10',
    borderRadius: AppTheme.borderRadius.md,
    padding: AppTheme.spacing.md,
    alignItems: 'center',
    marginBottom: AppTheme.spacing.lg,
    borderWidth: 1,
    borderColor: AppTheme.colors.warning + '30',
  },
  bulbIcon: {
    marginRight: AppTheme.spacing.md,
  },
  suggestionContent: {
    flex: 1,
  },
  suggestionTitle: {
    fontSize: AppTheme.typography.fontSize.md,
    fontWeight: AppTheme.typography.fontWeight.semibold,
    color: AppTheme.colors.text,
    marginBottom: AppTheme.spacing.xs,
  },
  suggestionText: {
    fontSize: AppTheme.typography.fontSize.sm,
    color: AppTheme.colors.textSecondary,
    fontStyle: 'italic',
  },
  createButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: AppTheme.colors.primary,
    borderRadius: AppTheme.borderRadius.md,
    paddingVertical: AppTheme.spacing.md,
    paddingHorizontal: AppTheme.spacing.xl,
    marginBottom: AppTheme.spacing.lg,
    minWidth: 200,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  buttonIcon: {
    marginRight: AppTheme.spacing.sm,
  },
  buttonText: {
    fontSize: AppTheme.typography.fontSize.md,
    fontWeight: AppTheme.typography.fontWeight.semibold,
    color: '#FFFFFF',
  },
  features: {
    flexDirection: 'row',
    gap: AppTheme.spacing.lg,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: AppTheme.spacing.xs,
  },
  featureText: {
    fontSize: AppTheme.typography.fontSize.sm,
    color: AppTheme.colors.textSecondary,
  },
});

export default PlaceholderPage;
