import { useCallback, useState } from 'react';
import {
  View, Text, FlatList, Pressable, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, router } from 'expo-router';
import FontAwesome from '@expo/vector-icons/FontAwesome';

import {
  getChatSessions,
  createChatSession,
  deleteChatSession,
} from '~/db/repositories/chat.repository';
import { getSetting } from '~/db/repositories/settings.repository';
import { providerRegistry } from '~/llm/provider-registry';
import type { ChatSession } from '~/db/schema';
import type { LLMProviderName } from '~/llm/types';

// ─── Time formatting ─────────────────────────────────────────────────────────

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ─── Provider badge ──────────────────────────────────────────────────────────

const PROVIDER_STYLES: Record<string, { bg: string; text: string }> = {
  openai:    { bg: 'bg-green-100 dark:bg-green-900',   text: 'text-green-700 dark:text-green-300' },
  anthropic: { bg: 'bg-orange-100 dark:bg-orange-900', text: 'text-orange-700 dark:text-orange-300' },
  gemini:    { bg: 'bg-blue-100 dark:bg-blue-900',     text: 'text-blue-700 dark:text-blue-300' },
};

function ProviderBadge({ provider }: { provider: string }) {
  const styles = PROVIDER_STYLES[provider] ?? { bg: 'bg-gray-100 dark:bg-gray-800', text: 'text-gray-600 dark:text-gray-400' };
  return (
    <View className={`px-2 py-0.5 rounded-full ${styles.bg}`}>
      <Text className={`text-xs font-medium ${styles.text}`}>{provider}</Text>
    </View>
  );
}

// ─── Session row ─────────────────────────────────────────────────────────────

function SessionRow({
  session,
  onPress,
  onLongPress,
}: {
  session: ChatSession;
  onPress: () => void;
  onLongPress: () => void;
}) {
  return (
    <Pressable
      className="flex-row items-center px-4 py-3 active:opacity-70"
      onPress={onPress}
      onLongPress={onLongPress}
    >
      <View className="w-10 h-10 rounded-full bg-primary-100 dark:bg-primary-900 items-center justify-center mr-3">
        <FontAwesome name="comment-o" size={18} color="#2563eb" />
      </View>
      <View className="flex-1 min-w-0">
        <Text className="text-sm font-medium text-gray-900 dark:text-white" numberOfLines={1}>
          {session.title ?? 'New conversation'}
        </Text>
        <Text className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          {timeAgo(session.updatedAt)}
        </Text>
      </View>
      <View className="ml-2 items-end gap-1">
        <ProviderBadge provider={session.provider} />
        <FontAwesome name="chevron-right" size={11} color="#9ca3af" />
      </View>
    </Pressable>
  );
}

// ─── Main screen ─────────────────────────────────────────────────────────────

export default function ChatsScreen() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [loading, setLoading]   = useState(true);
  const [creating, setCreating] = useState(false);

  const loadSessions = useCallback(async () => {
    try {
      const data = await getChatSessions(50);
      setSessions(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      loadSessions();
    }, [loadSessions])
  );

  async function handleNewChat() {
    if (creating) return;
    setCreating(true);
    try {
      const [providerName, model] = await Promise.all([
        getSetting('active_provider') as Promise<LLMProviderName>,
        getSetting('active_model'),
      ]);

      const provider = await providerRegistry.getProvider(providerName);
      if (!provider) {
        Alert.alert('No API Key', `No API key configured for ${providerName}. Go to Settings → API Keys to add one.`);
        return;
      }

      const id = await createChatSession({ provider: providerName, model, searchMode: 'full' });
      router.push(`/chat/${id}`);
    } catch (e: unknown) {
      Alert.alert('Error', (e as Error).message ?? 'Could not start chat');
    } finally {
      setCreating(false);
    }
  }

  function handleDelete(session: ChatSession) {
    Alert.alert(
      'Delete conversation',
      `Delete "${session.title ?? 'this conversation'}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteChatSession(session.id);
            setSessions(prev => prev.filter(s => s.id !== session.id));
          },
        },
      ]
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-gray-50 dark:bg-gray-950" edges={['bottom']}>
      <View className="flex-row items-center justify-between px-4 pt-4 pb-3">
        <View>
          <Text className="text-2xl font-bold text-gray-900 dark:text-white">Chats</Text>
          <Text className="text-sm text-gray-500 dark:text-gray-400">
            Ask questions about your records
          </Text>
        </View>
        <Pressable
          className="w-11 h-11 rounded-full bg-primary-600 items-center justify-center active:opacity-70"
          onPress={handleNewChat}
          disabled={creating}
        >
          {creating
            ? <ActivityIndicator size="small" color="white" />
            : <FontAwesome name="edit" size={18} color="white" />}
        </Pressable>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      ) : sessions.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-4xl mb-4">💬</Text>
          <Text className="text-lg font-semibold text-gray-700 dark:text-gray-300 mb-2">
            No conversations yet
          </Text>
          <Text className="text-gray-500 dark:text-gray-500 text-center mb-6">
            Ask questions about your health records. Your conversations stay on this device.
          </Text>
          <Pressable
            className="bg-primary-600 px-6 py-3 rounded-xl active:opacity-70"
            onPress={handleNewChat}
            disabled={creating}
          >
            {creating
              ? <ActivityIndicator size="small" color="white" />
              : <Text className="text-white font-semibold">Start a new chat</Text>}
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={sessions}
          keyExtractor={s => s.id}
          contentContainerStyle={{ paddingBottom: 32 }}
          ItemSeparatorComponent={() => (
            <View className="h-px bg-gray-100 dark:bg-gray-800 ml-[60px]" />
          )}
          renderItem={({ item }) => (
            <SessionRow
              session={item}
              onPress={() => router.push(`/chat/${item.id}`)}
              onLongPress={() => handleDelete(item)}
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}
