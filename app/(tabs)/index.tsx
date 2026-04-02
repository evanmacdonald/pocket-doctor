import { View, Text, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function RecordsScreen() {
  return (
    <SafeAreaView className="flex-1 bg-white dark:bg-gray-950" edges={['bottom']}>
      <ScrollView className="flex-1 px-4 pt-4">
        <Text className="text-2xl font-bold text-gray-900 dark:text-white mb-1">
          Health Records
        </Text>
        <Text className="text-gray-500 dark:text-gray-400 mb-6">
          All data stored privately on this device.
        </Text>

        {/* Empty state */}
        <View className="items-center justify-center py-24">
          <Text className="text-5xl mb-4">📋</Text>
          <Text className="text-lg font-semibold text-gray-700 dark:text-gray-300 mb-2">
            No records yet
          </Text>
          <Text className="text-gray-500 dark:text-gray-500 text-center px-8">
            Upload a PDF or scan a document to get started.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
