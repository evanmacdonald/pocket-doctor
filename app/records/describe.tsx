import { View, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';

// Stub — full implementation in PR 4 (feat/natural-language-entry)
export default function DescribeRecordScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Describe in Words' }} />
      <SafeAreaView className="flex-1 bg-gray-50 dark:bg-gray-950 items-center justify-center px-8" edges={['bottom']}>
        <Text className="text-4xl mb-4">✍️</Text>
        <Text className="text-lg font-semibold text-gray-900 dark:text-white mb-2 text-center">
          Coming soon
        </Text>
        <Text className="text-sm text-gray-500 dark:text-gray-400 text-center">
          Describe a health record in plain English and let AI extract the details for you.
        </Text>
      </SafeAreaView>
    </>
  );
}
