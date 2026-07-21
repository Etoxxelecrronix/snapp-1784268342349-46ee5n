import { createClient } from '@supabase/supabase-js';
import * as keys from './keys';

// Snapp runs your app in TWO different runtimes:
//   • iOS     → an HTML bundle inside Safari (browser)  → window.localStorage exists
//   • Android → native code execution (no browser)      → AsyncStorage is provided
//               ambiently by the Snapp runtime instead of localStorage
// This adapter picks the right session storage at runtime so the auth session
// persists on BOTH platforms. `typeof` checks never throw, and the branch for the
// other platform is never executed — so nothing here breaks either build or runtime.
declare const localStorage: any;
declare const AsyncStorage: any;

function getAuthStorage() {
  if (typeof localStorage !== 'undefined' && localStorage) {
    return localStorage; // iOS / browser runtime
  }
  if (typeof AsyncStorage !== 'undefined' && AsyncStorage) {
    // Android: AsyncStorage is sandboxed per app by the Snapp runtime.
    return {
      getItem: (key: string) => AsyncStorage.getItem(key),
      setItem: (key: string, value: string) => AsyncStorage.setItem(key, value),
      removeItem: (key: string) => AsyncStorage.removeItem(key),
    };
  }
  return undefined; // Fallback: in-memory (session won't persist across restarts)
}

// Credentials are auto-injected into keys.ts when the user connects Supabase.
const supabaseUrl = (keys as any).SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseAnonKey = (keys as any).SUPABASE_ANON_KEY || 'placeholder-anon-key';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: getAuthStorage() as any,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});
