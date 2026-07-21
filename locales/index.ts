// Localization system setup (i18n-js + expo-localization)
//
// 🤖 AI CRITICAL INSTRUCTIONS - READ CAREFULLY:
// 1. Detect user's prompt language (English→'en', Turkish→'tr', Spanish→'es', etc.)
// 2. Create ONLY the needed language file (e.g., 'tr.ts' for Turkish prompts)
// 3. Import the language file BELOW this comment
// 4. Register it in I18n constructor
// 5. Set defaultLocale to match the language
//
// ✅ CORRECT EXAMPLE for Turkish user:
//   import tr from './tr';
//   const i18n = new I18n({ tr });
//   i18n.defaultLocale = 'tr';
//
// ✅ CORRECT EXAMPLE for English user:
//   import en from './en';
//   const i18n = new I18n({ en });
//   i18n.defaultLocale = 'en';
//
// ❌ WRONG: Do NOT create files like 'languageCode.ts' - use actual codes (en, tr, es)

import { I18n } from 'i18n-js';
import * as Localization from 'expo-localization';
import { useState } from 'react';

// 🤖 AI: ADD YOUR LANGUAGE IMPORT HERE
// For Turkish → import tr from './tr';
// For English → import en from './en';

// 🤖 AI: REGISTER YOUR LANGUAGE HERE
const i18n = new I18n({
  // For Turkish → tr
  // For English → en
});

// Set locale from device settings with safe fallback
const deviceLocale = Localization.locale || Localization.getLocales?.()?.[0]?.languageCode || 'en';
i18n.locale = deviceLocale.split('-')[0]; // Extract language code (en-US → en)
i18n.enableFallback = true;
i18n.defaultLocale = 'en'; // 🤖 AI: Change this to match user's primary language

// Export i18n instance
export default i18n;

// React hook for translation with automatic re-rendering on language change
// ⚠️ CRITICAL: This hook uses React state to trigger component re-renders when language changes
export const useTranslation = () => {
  const [locale, setLocaleState] = useState(i18n.locale);

  const setLocale = (newLocale: string) => {
    i18n.locale = newLocale;
    setLocaleState(newLocale); // Trigger re-render by updating state
  };

  return {
    t: (key: string) => i18n.t(key),
    locale,
    setLocale,
  };
};
