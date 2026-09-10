import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { DeviceEventEmitter } from 'react-native';
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
    const sub = DeviceEventEmitter.addListener('ON_REEL_COPIED', async (url) => {
      console.log('Doomscroll Mode: Caught URL ->', url);
      // Step 3 will flesh out the queue. For now, just run it!
      try {
        const result = await analyzeReelApi(url);
        await saveReelResult(result);
        console.log('Doomscroll Mode: Finished ->', result.verdict);
        // TODO: Step 4 - Push Notification
      } catch (e) {
        console.log('Doomscroll Mode: Failed ->', e.message);
      }
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
