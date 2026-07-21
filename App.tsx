import React from 'react';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Theme } from './theme/AppTheme';

import HomePage from './screens/HomePage';
import FolderBrowserPage from './screens/FolderBrowserPage';
import PlaylistManagerPage from './screens/PlaylistManagerPage';
import AnalysisProgressPage from './screens/AnalysisProgressPage';
import SDCardSelectorPage from './screens/SDCardSelectorPage';
import SyncSettingsPage from './screens/SyncSettingsPage';

export type RootStackParamList = {
  Home: undefined;
  FolderBrowser: { folderName?: string };
  PlaylistManager: undefined;
  AnalysisProgress: undefined;
  SDCardSelector: undefined;
  SyncSettings: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

const navTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: Theme.colors.background,
    card: Theme.colors.backgroundSecondary,
    text: Theme.colors.text,
    border: Theme.colors.border,
    primary: Theme.colors.primary,
  },
};

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <NavigationContainer theme={navTheme}>
        <StatusBar style="light" backgroundColor={Theme.colors.background} />
        <Stack.Navigator
          initialRouteName="Home"
          screenOptions={{
            headerShown: false,
            animation: 'slide_from_right',
            contentStyle: { backgroundColor: Theme.colors.background },
          }}
        >
          <Stack.Screen name="Home" component={HomePage} />
          <Stack.Screen name="FolderBrowser" component={FolderBrowserPage} />
          <Stack.Screen name="PlaylistManager" component={PlaylistManagerPage} />
          <Stack.Screen name="AnalysisProgress" component={AnalysisProgressPage} />
          <Stack.Screen name="SDCardSelector" component={SDCardSelectorPage} />
          <Stack.Screen name="SyncSettings" component={SyncSettingsPage} />
        </Stack.Navigator>
      </NavigationContainer>
    </GestureHandlerRootView>
  );
}
