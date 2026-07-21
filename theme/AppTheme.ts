// This file contains ONLY theme definitions - no imports, no logic

export const Theme = {
  colors: {
    // TODO: Customize based on app purpose
    //
    // ⚠️ SEMANTIC PALETTE — these MUST stay flat color STRINGS (never nested objects).
    // Generated code frequently writes `color: AppTheme.colors.text` directly, so if
    // `text` were an object the app would crash with "Failed to load app component".
    // Customize the hex values for your app, but keep every key below a string.
    primary: '#1DB954',
    primaryDark: '#158940',
    primaryLight: '#4ECB72',
    secondary: '#191414',
    accent: '#1ED760',
    // Backgrounds & surfaces
    background: '#121212',
    backgroundSecondary: '#191414',
    surface: '#1E1E1E',
    card: '#282828',
    overlay: 'rgba(0,0,0,0.7)',
    // Text (flat strings — also expose *Secondary/*Muted variants the AI commonly uses)
    text: '#FFFFFF',
    textSecondary: '#B3B3B3',
    textMuted: '#6A6A6A',
    textInverse: '#121212',
    // Lines & states
    border: 'rgba(255,255,255,0.1)',
    divider: 'rgba(255,255,255,0.06)',
    disabled: '#404040',
    placeholder: '#6A6A6A',
    // Status colors
    success: '#1DB954',
    error: '#E91429',
    danger: '#E91429',
    warning: '#F59E0B',
    info: '#509BF5',
    // Neutrals
    white: '#FFFFFF',
    black: '#000000',
    transparent: 'transparent',
    // Modern gradient presets for premium look
    gradient: {
      // Must be a 2+ color ARRAY — LinearGradient calls colors.map(), so an empty
      // string crashed apps with "Cannot read property 'map' of undefined".
      primary: ['#1DB954', '#158940'],
      secondary: ['#191414', '#282828'],
      success: ['#1DB954', '#4ECB72'],
      info: ['#509BF5', '#3B82F6'],
      warning: ['#fa709a', '#fee140'],
      danger: ['#E91429', '#ff6a00'],
      dark: ['#121212', '#282828'],
    },
    // Glassmorphism colors
    glass: {
      light: 'rgba(255, 255, 255, 0.08)',
      medium: 'rgba(255, 255, 255, 0.15)',
      dark: 'rgba(0, 0, 0, 0.3)',
      border: 'rgba(255, 255, 255, 0.12)',
    },
    // Tab bar / selection states (for navigation)
    selection: {
      active: '#1DB954',
      inactive: '#6A6A6A',
    },
  },
  spacing: {
    xs: 2,
    sm: 5,
    md: 10,
    lg: 15,
    xl: 20,
    xxl: 25,
  },
  borderRadius: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
    xxl: 32,
    full: 9999,
  },
  // Modern elevation system (shadows & depth)
  elevation: {
    none: {
      shadowColor: 'transparent',
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0,
      shadowRadius: 0,
      elevation: 0,
    },
    xs: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.05,
      shadowRadius: 2,
      elevation: 1,
    },
    sm: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.1,
      shadowRadius: 4,
      elevation: 3,
    },
    md: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.15,
      shadowRadius: 8,
      elevation: 6,
    },
    lg: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.2,
      shadowRadius: 16,
      elevation: 12,
    },
    xl: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 12 },
      shadowOpacity: 0.25,
      shadowRadius: 24,
      elevation: 18,
    },
  },
  typography: {
    fontSize: {
      xs: 7,
      sm: 8,
      md: 10,
      regular: 10,
      lg: 11,
      xl: 13,
      xxl: 14,
      title: 14,
      heading: 17,
      display: 19,
    },
    fontWeight: {
      light: '300',
      normal: '400',
      medium: '500',
      semibold: '600',
      bold: '700',
      extrabold: '800',
    },
    lineHeight: {
      tight: 1.2,
      normal: 1.5,
      relaxed: 1.75,
    },
  },
  // Alias for backward compatibility with generated code
  fontSizes: {
    small: 8,
    regular: 10,
    medium: 11,
    large: 13,
    xlarge: 14,
  },
  // Animation timing constants
  animation: {
    fast: 150,
    normal: 300,
    slow: 500,
    verySlow: 800,
  },
  // Opacity levels for consistent alpha values
  opacity: {
    disabled: 0.4,
    hover: 0.8,
    pressed: 0.6,
    overlay: 0.5,
  },
};

export const AppTheme = Theme;
