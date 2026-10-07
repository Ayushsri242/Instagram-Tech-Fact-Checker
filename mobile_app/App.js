import React, { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { DeviceEventEmitter, NativeModules } from 'react-native';
const { TechFactChecker } = NativeModules;
import { analyzeReelApi, sleep } from './src/services/api';
import { saveReelResult, setOfflineMode } from './src/services/storage';
import { beginAnalysis, finishAnalysis, failAnalysis } from './src/services/jobNotify';
import { trace, shortRef } from './src/services/trace';
import { setJobsWaiting } from './src/services/jobState';
import { checkForUpdates } from './src/services/updater';
import HomeScreen from './src/screens/HomeScreen';
import ResultScreen from './src/screens/ResultScreen';
import HistoryScreen from './src/screens/HistoryScreen';
import ChatScreen from './src/screens/ChatScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import WelcomeScreen, { PERMISSIONS_DONE_KEY } from './src/screens/WelcomeScreen';
import { colors } from './src/theme/colors';

const Stack = createNativeStackNavigator();

export default function App() {
  // First launch shows the permissions screen; after that, straight to Home.
  // Read before the navigator mounts so the first frame is the right screen. A
  // deep link from a notification still wins - linking overrides this.
  const [firstRoute, setFirstRoute] = useState(null);
  // Check for an update the moment the app opens. It used to wait for Home to
  // mount, which on a first launch is only after the whole Welcome flow.
  useEffect(() => {
    checkForUpdates();
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

  useEffect(() => {
// 1-minute Cooldown Queue implementation
    const queue = [];
    let isProcessing = false;

    const processQueue = async () => {
      if (isProcessing || queue.length === 0) {
        if (queue.length) trace('doomscroll: ' + queue.length + ' waiting - previous reel still in cooldown');
        return;
      }
      isProcessing = true;

      const url = queue.shift();
      setJobsWaiting(queue.length);
      console.log('Doomscroll Mode: Processing URL ->', url);
      const startedAt = Date.now();
      trace('doomscroll: start ' + shortRef(url) + ', ' + queue.length + ' still waiting' +
        (queue.length ? ' (' + queue.map(shortRef).join(', ') + ')' : ''));

      let hadError = false;
      try {
        // Bubble turns cyan/blue while processing.
        TechFactChecker.setBubbleColor("#00E5FF");
        // Same keep-alive and notifications as the paste flow, so the two
        // entry points cannot drift apart again.
        beginAnalysis(shortRef(url));

        const result = await analyzeReelApi(url);
        await saveReelResult(result);

        console.log('Doomscroll Mode: Finished ->', result.verdict);

        // Doomscroll runs while the user is inside another app by definition,
        // so always notify - even if this app happens to be in front.
        await finishAnalysis(result, { alwaysNotify: true });
        trace('doomscroll: done ' + shortRef(url) + ' verdict=' + result.verdict + ' in ' + Math.round((Date.now() - startedAt) / 1000) + 's');
      } catch (e) {
        hadError = true;
        console.log('Doomscroll Mode: Failed ->', e.message);
        trace('doomscroll: FAILED ' + shortRef(url) + ' after ' + Math.round((Date.now() - startedAt) / 1000) + 's - ' + String(e && e.message).slice(0, 120));
        await failAnalysis(e && e.message);
      } finally {
        TechFactChecker.setBubbleColor("#00E5FF");
      }

      // Enforce 1-minute (60000ms) cooldown before next item ONLY on success.
      // If analysis failed, reset immediately so user isn't stuck waiting.
      if (!hadError) {
        if (queue.length) {
          trace('doomscroll: cooldown 60s, next ' + shortRef(queue[0]) + ' starts at ' + new Date(Date.now() + 60000).toTimeString().slice(0, 8));
        }
        await sleep(60000);
      }
      isProcessing = false;
      processQueue();
    };

    const sub = DeviceEventEmitter.addListener('ON_REEL_COPIED', (url) => {
      console.log('Doomscroll Mode: Caught URL ->', url);
      TechFactChecker.setBubbleColor("#00E5FF"); // Immediately reset to blue so user can queue next reel
      // If the bubble logged a copy and this line is missing, JS was frozen.
      trace('doomscroll: JS received reel ' + shortRef(url) + ', queue now ' + (queue.length + 1));
      queue.push(url);
      setJobsWaiting(queue.length);
      processQueue();
    });
    return () => sub.remove();
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
