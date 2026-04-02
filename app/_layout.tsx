import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack, router } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import '../global.css';

import { useColorScheme } from '@/components/useColorScheme';
import { openDatabase } from '~/db/client';
import { biometricService } from '~/auth/biometric.service';

export { ErrorBoundary } from 'expo-router';

export const unstable_settings = {
  initialRouteName: '(tabs)',
};

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  });
  const [dbReady, setDbReady] = useState(false);

  // Initialize database on first load
  useEffect(() => {
    openDatabase()
      .then(() => setDbReady(true))
      .catch((e) => { throw e; });
  }, []);

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded && dbReady) {
      SplashScreen.hideAsync();
    }
  }, [loaded, dbReady]);

  if (!loaded || !dbReady) return null;

  return <RootLayoutNav />;
}

function RootLayoutNav() {
  const colorScheme = useColorScheme();
  const appState = useRef(AppState.currentState);

  // Initialize biometric service and lock on background
  useEffect(() => {
    biometricService.initialize();
    return () => biometricService.destroy();
  }, []);

  // Re-prompt when app comes to foreground
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      if (
        appState.current.match(/inactive|background/) &&
        nextState === 'active' &&
        biometricService.isLocked
      ) {
        router.replace('/(auth)/unlock');
      }
      appState.current = nextState;
    });
    return () => sub.remove();
  }, []);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="(auth)"   options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)"   options={{ headerShown: false }} />
        <Stack.Screen name="records"  options={{ headerShown: false }} />
        <Stack.Screen name="+not-found" />
      </Stack>
    </ThemeProvider>
  );
}
