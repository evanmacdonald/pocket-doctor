import { View, Text, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';

interface SettingsRowProps {
  label: string;
  subtitle?: string;
  onPress?: () => void;
  value?: string;
}

function SettingsRow({ label, subtitle, onPress, value }: SettingsRowProps) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center justify-between px-4 py-3.5 bg-white dark:bg-gray-900 active:opacity-70"
    >
      <View className="flex-1 mr-4">
        <Text className="text-base text-gray-900 dark:text-white">{label}</Text>
        {subtitle && (
          <Text className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {subtitle}
          </Text>
        )}
      </View>
      {value && (
        <Text className="text-sm text-gray-400 dark:text-gray-500">{value}</Text>
      )}
      <Text className="text-gray-300 dark:text-gray-600 ml-2">›</Text>
    </Pressable>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <Text className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider px-4 pt-6 pb-2">
      {title}
    </Text>
  );
}

function Divider() {
  return (
    <View className="h-px bg-gray-100 dark:bg-gray-800 ml-4" />
  );
}

export default function SettingsScreen() {
  return (
    <SafeAreaView className="flex-1 bg-gray-50 dark:bg-gray-950" edges={['bottom']}>
      <ScrollView className="flex-1">

        <SectionHeader title="AI & Chat" />
        <View className="rounded-xl overflow-hidden mx-4 border border-gray-100 dark:border-gray-800">
          <SettingsRow
            label="API Keys"
            subtitle="OpenAI, Anthropic, or Gemini"
            onPress={() => router.push('/settings/api-keys')}
          />
          <Divider />
          <SettingsRow
            label="Search Mode"
            subtitle="Smart (RAG) or keyword search"
            value="Keyword"
          />
          <Divider />
          <SettingsRow
            label="Active Model"
            value="gpt-4o-mini"
          />
        </View>

        <SectionHeader title="Data & Backup" />
        <View className="rounded-xl overflow-hidden mx-4 border border-gray-100 dark:border-gray-800">
          <SettingsRow
            label="Export Health Records"
            subtitle="Encrypted file you can store anywhere"
            onPress={() => {}}
          />
          <Divider />
          <SettingsRow
            label="Import Records"
            subtitle="Restore from an exported file"
            onPress={() => {}}
          />
          <Divider />
          <SettingsRow
            label="Connected Portals"
            subtitle="BC Health Gateway, etc."
            onPress={() => {}}
          />
        </View>

        <SectionHeader title="About" />
        <View className="rounded-xl overflow-hidden mx-4 border border-gray-100 dark:border-gray-800">
          <SettingsRow
            label="Version"
            value="1.0.0"
          />
          <Divider />
          <SettingsRow
            label="Open Source on GitHub"
            onPress={() => {}}
          />
        </View>

        {/* Privacy note */}
        <Text className="text-xs text-gray-400 dark:text-gray-600 text-center mx-8 mt-8 mb-4">
          All health data is stored locally on this device.{'\n'}
          Nothing is sent to any server. Your LLM queries go directly{'\n'}
          to your chosen provider using your own API key.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
