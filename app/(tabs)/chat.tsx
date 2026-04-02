import { View, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function ChatScreen() {
  return (
    <SafeAreaView className="flex-1 bg-white dark:bg-gray-950" edges={['bottom']}>
      <View className="flex-1 items-center justify-center px-8">
        <Text className="text-5xl mb-4">💬</Text>
        <Text className="text-lg font-semibold text-gray-700 dark:text-gray-300 mb-2">
          Chat with your records
        </Text>
        <Text className="text-gray-500 dark:text-gray-500 text-center">
          Add health records and an API key in Settings to start chatting.
        </Text>
      </View>
    </SafeAreaView>
  );
}
