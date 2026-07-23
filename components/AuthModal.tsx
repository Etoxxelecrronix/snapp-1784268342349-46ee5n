import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import BottomSheet, { BottomSheetView } from '@gorhom/bottom-sheet';
import { supabase } from '../supabase';
import { Theme } from '../theme/AppTheme';

interface AuthModalProps {
  visible: boolean;
  onClose: () => void;
}

const AuthModal: React.FC<AuthModalProps> = ({ visible, onClose }) => {
  const sheetRef = useRef<BottomSheet>(null);
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (visible) {
      sheetRef.current?.expand();
    } else {
      sheetRef.current?.close();
    }
  }, [visible]);

  const handleSheetChange = useCallback(
    (index: number) => {
      if (index === -1) {
        onClose();
      }
    },
    [onClose]
  );

  const handleSubmit = async () => {
    setError('');
    setSuccess('');
    if (!email.trim() || !password) {
      setError('Bitte E-Mail und Passwort eingeben.');
      return;
    }
    setLoading(true);
    try {
      if (isLogin) {
        const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (err) throw err;
        sheetRef.current?.close();
      } else {
        const { error: err } = await supabase.auth.signUp({ email: email.trim(), password });
        if (err) throw err;
        setSuccess('Bitte bestätige deine E-Mail-Adresse!');
      }
    } catch (e: any) {
      setError(e?.message || 'Ein Fehler ist aufgetreten.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <BottomSheet
      ref={sheetRef}
      index={-1}
      snapPoints={['60%', '80%']}
      enablePanDownToClose
      onChange={handleSheetChange}
      backgroundStyle={styles.sheetBg}
      handleIndicatorStyle={styles.handle}
    >
      <BottomSheetView style={styles.content}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.inner}
        >
          <Text style={styles.title}>{isLogin ? 'Willkommen zurück' : 'Konto erstellen'}</Text>
          <Text style={styles.subtitle}>
            {isLogin ? 'Melde dich mit deiner E-Mail an' : 'Registriere dich kostenlos'}
          </Text>

          <TextInput
            style={styles.input}
            placeholder="E-Mail"
            placeholderTextColor={Theme.colors.textMuted}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
          />
          <TextInput
            style={styles.input}
            placeholder="Passwort"
            placeholderTextColor={Theme.colors.textMuted}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />

          {!!error && <Text style={styles.error}>{error}</Text>}
          {!!success && <Text style={styles.success}>{success}</Text>}

          <TouchableOpacity
            style={styles.button}
            onPress={handleSubmit}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.buttonText}>{isLogin ? 'Anmelden' : 'Registrieren'}</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => {
              setIsLogin(!isLogin);
              setError('');
              setSuccess('');
            }}
          >
            <Text style={styles.toggle}>
              {isLogin ? 'Noch kein Konto? Registrieren' : 'Schon ein Konto? Anmelden'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={() => sheetRef.current?.close()}>
            <Text style={styles.cancel}>Abbrechen</Text>
          </TouchableOpacity>
        </KeyboardAvoidingView>
      </BottomSheetView>
    </BottomSheet>
  );
};

const styles = StyleSheet.create({
  sheetBg: {
    backgroundColor: Theme.colors.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  handle: {
    backgroundColor: Theme.colors.border,
    width: 40,
  },
  content: {
    flex: 1,
  },
  inner: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 32,
  },
  title: {
    fontSize: 22,
    fontWeight: Theme.typography.fontWeight.bold as any,
    color: Theme.colors.text,
    textAlign: 'center',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: Theme.typography.fontSize.sm,
    color: Theme.colors.textMuted,
    textAlign: 'center',
    marginBottom: 24,
  },
  input: {
    borderWidth: 1,
    borderColor: Theme.colors.border,
    borderRadius: Theme.borderRadius.md,
    paddingHorizontal: 16,
    paddingVertical: 13,
    fontSize: Theme.typography.fontSize.md,
    color: Theme.colors.text,
    backgroundColor: Theme.colors.surface,
    marginBottom: 12,
  },
  error: {
    color: '#dc2626',
    fontSize: Theme.typography.fontSize.sm,
    marginBottom: 8,
    textAlign: 'center',
  },
  success: {
    color: '#16a34a',
    fontSize: Theme.typography.fontSize.sm,
    marginBottom: 8,
    textAlign: 'center',
  },
  button: {
    backgroundColor: Theme.colors.primary,
    borderRadius: Theme.borderRadius.md,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 4,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: Theme.typography.fontSize.md,
    fontWeight: Theme.typography.fontWeight.semibold as any,
  },
  toggle: {
    color: Theme.colors.textSecondary,
    fontSize: Theme.typography.fontSize.sm,
    textAlign: 'center',
    marginTop: 16,
  },
  cancel: {
    color: Theme.colors.textMuted,
    fontSize: Theme.typography.fontSize.sm,
    textAlign: 'center',
    marginTop: 12,
  },
});

export default AuthModal;
