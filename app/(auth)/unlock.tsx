import { useEffect, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { biometricService } from '~/auth/biometric.service';

export default function UnlockScreen() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-prompt on mount
  useEffect(() => {
    handleUnlock();
  }, []);

  async function handleUnlock() {
    setLoading(true);
    setError(null);

    try {
      const success = await biometricService.authenticate();
      if (success) {
        router.replace('/(tabs)');
      } else {
        setError('Authentication failed. Tap to try again.');
      }
    } catch (e) {
      setError('Something went wrong. Tap to try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <View className="flex-1 items-center justify-center bg-white dark:bg-gray-950 px-8">
      {/* Logo / icon area */}
      <View className="w-20 h-20 rounded-2xl bg-primary-600 items-center justify-center mb-8">
        <Text className="text-white text-4xl">🩺</Text>
      </View>

      <Text className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
        Pocket Doctor
      </Text>
      <Text className="text-gray-500 dark:text-gray-400 text-center mb-12">
        Your health records, private and on-device.
      </Text>

      {loading ? (
        <ActivityIndicator size="large" color="#2563eb" />
      ) : (
        <Pressable
          onPress={handleUnlock}
          className="bg-primary-600 px-8 py-4 rounded-2xl active:opacity-80"
        >
          <Text className="text-white font-semibold text-base">
            {error ? 'Try Again' : 'Unlock with Face ID'}
          </Text>
        </Pressable>
      )}

      {error && (
        <Text className="text-red-500 text-sm text-center mt-4">{error}</Text>
      )}

      <Text className="text-xs text-gray-400 dark:text-gray-600 text-center mt-16 px-4">
        All data is stored locally on this device.{'\n'}
        Nothing is sent to any server.
      </Text>
    </View>
  );
}
