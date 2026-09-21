import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { DeviceEventEmitter, NativeModules } from 'react-native';
const { TechFactChecker } = NativeModules;
import { analyzeReelApi } from './src/services/api';
import { saveReelResult } from './src/services/storage';
import HomeScreen from './src/screens/HomeScreen';
import ResultScreen from './src/screens/ResultScreen';
import HistoryScreen from './src/screens/HistoryScreen';
import ChatScreen from './src/screens/ChatScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import { colors } from './src/theme/colors';

const Stack = createNativeStackNavigator();

export default function App() {
  useEffect(() => {
// 1-minute Cooldown Queue implementation
    const queue = [];
    let isProcessing = false;

    const processQueue = async () => {
      if (isProcessing || queue.length === 0) return;
      isProcessing = true;

      const url = queue.shift();
      console.log('Doomscroll Mode: Processing URL ->', url);

      try {
        // 1. Reset bubble to Blue
        TechFactChecker.setBubbleColor("#00E5FF");
        // 2. Show processing notification
        TechFactChecker.showNotification("Doomscroll Mode", "Processing Reel...");

        const result = await analyzeReelApi(url);
        await saveReelResult(result);
        
        console.log('Doomscroll Mode: Finished ->', result.verdict);
        
        // 3. Step 4 - Push Notification with verdict
        TechFactChecker.showNotification("Fact Check Complete", `VERDICT: ${result.verdict}`);
      } catch (e) {
        console.log('Doomscroll Mode: Failed ->', e.message);
        TechFactChecker.showNotification("Fact Check Failed", "Could not process reel.");
      }

      // Enforce 1-minute (60000ms) cooldown before next item
      setTimeout(() => {
        isProcessing = false;
        processQueue();
      }, 60000);
    };

    const sub = DeviceEventEmitter.addListener('ON_REEL_COPIED', (url) => {
      console.log('Doomscroll Mode: Caught URL ->', url);
      queue.push(url);
      processQueue();
    });
    return () => sub.remove();
  }, []);

  return (
    <NavigationContainer>
      <StatusBar style="light" backgroundColor={colors.background} />
      <Stack.Navigator
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
          options={{ title: 'Local Setup' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
