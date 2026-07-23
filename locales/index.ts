import { I18n } from 'i18n-js';
import * as Localization from 'expo-localization';
import { useState } from 'react';

const i18n = new I18n({});

const deviceLocale =
  Localization.getLocales?.()[0]?.languageCode ||
  (Localization as any).locale ||
  'de';

i18n.locale = deviceLocale.split('-')[0];
i18n.enableFallback = true;
i18n.defaultLocale = 'de';

export default i18n;

export const useTranslation = () => {
  const [locale, setLocaleState] = useState(i18n.locale);

  const setLocale = (newLocale: string) => {
    i18n.locale = newLocale;
    setLocaleState(newLocale);
  };

  return {
    t: (key: string) => i18n.t(key),
    locale,
    setLocale,
  };
};
