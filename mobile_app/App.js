import React, { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { setOfflineMode } from './src/services/storage';
import { startBubbleQueue, takePendingReels } from './src/services/bubbleQueue';
import { checkForUpdates } from './src/services/updater';
import { ensureKeyBackup } from './src/services/secrets';
import HomeScreen from './src/screens/HomeScreen';
import ResultScreen from './src/screens/ResultScreen';
import HistoryScreen from './src/screens/HistoryScreen';
import ChatScreen from './src/screens/ChatScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import WelcomeScreen, { PERMISSIONS_DONE_KEY } from './src/screens/WelcomeScreen';
import { colors } from './src/theme/colors';

const Stack = createNativeStackNavigator();

// Started when the JS engine loads, not when a screen mounts: the bubble must
// keep working after the user leaves the app (Oct 8, stuck-orange bubble).
startBubbleQueue();

export default function App() {
  // First launch shows the permissions screen; after that, straight to Home.
  // Read before the navigator mounts so the first frame is the right screen. A
  // deep link from a notification still wins - linking overrides this.
  const [firstRoute, setFirstRoute] = useState(null);
  // Check for an update the moment the app opens. It used to wait for Home to
  // mount, which on a first launch is only after the whole Welcome flow.
  useEffect(() => {
    checkForUpdates();
    // A key saved before the Downloads backup existed gets one now.
    ensureKeyBackup();
  }, []);

  useEffect(() => {
    AsyncStorage.getItem(PERMISSIONS_DONE_KEY)
      .then((v) => setFirstRoute(v === 'yes' ? 'Home' : 'Permissions'))
      .catch(() => setFirstRoute('Home'));
  }, []);

  // The on-device models are gone from this build: speech runs on Groq's
  // Whisper and there is no offline Gemma. Reclaim the ~160 MB Whisper (and
  // any 529 MB Gemma) earlier builds downloaded, and make sure nobody is left
  // in an offline mode that can no longer run.
  useEffect(() => {
    FileSystem.deleteAsync(FileSystem.documentDirectory + 'models/', { idempotent: true }).catch(() => {});
    setOfflineMode(false).catch(() => {});
  }, []);

  // The bubble's queue runs outside this component (see bubbleQueue.js); on
  // each open, also collect any link the bubble saved while nothing listened.
  useEffect(() => {
    takePendingReels();
  }, []);

  const linking = {
    prefixes: ['techfactchecker://', 'com.techfactchecker.mobile://'],
    config: {
      screens: {
        Home: 'home',
        Result: 'result/:reelId',
        History: 'history',
      },
    },
  };

  if (!firstRoute) return null;

  return (
    <NavigationContainer linking={linking}>
      <StatusBar style="light" backgroundColor={colors.background} />
      <Stack.Navigator
        initialRouteName={firstRoute}
        screenOptions={{
          headerStyle: {
            backgroundColor: colors.surface,
          },
          headerTintColor: colors.textPrimary,
          headerTitleStyle: {
            fontWeight: 'bold',
          },
          contentStyle: {
            backgroundColor: colors.background,
          },
        }}
      >
        <Stack.Screen
          name="Home"
          component={HomeScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="Result"
          component={ResultScreen}
          options={{ title: 'Fact-Check Report' }}
        />
        <Stack.Screen
          name="History"
          component={HistoryScreen}
          options={{ title: 'Saved Library' }}
        />
        <Stack.Screen
          name="Chat"
          component={ChatScreen}
          options={{ title: 'Ask AI' }}
        />
        <Stack.Screen
          name="Settings"
          component={SettingsScreen}
          options={{ title: 'Settings' }}
        />
        <Stack.Screen
          name="Permissions"
          component={WelcomeScreen}
          options={{ title: 'Welcome' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
