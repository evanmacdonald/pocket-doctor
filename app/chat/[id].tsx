import { useEffect, useRef, useState } from 'react';
import {
  View, Text, FlatList, TextInput, Pressable,
  KeyboardAvoidingView, Platform, Alert, ActivityIndicator,
  useColorScheme,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router, Stack } from 'expo-router';
import { useHeaderHeight } from '@react-navigation/elements';
import FontAwesome from '@expo/vector-icons/FontAwesome';

import { getChatMessages, getChatSession, deleteChatSession } from '~/db/repositories/chat.repository';
import { sendMessage } from '~/llm/chat.service';
import type { ChatMessage } from '~/db/schema';

// ─── Types ───────────────────────────────────────────────────────────────────

type DisplayMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
};

const STREAMING_ID = '__streaming__';

function toDisplayMessages(history: ChatMessage[]): DisplayMessage[] {
  return history
    .slice()
    .reverse()
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => ({ id: m.id, role: m.role as 'user' | 'assistant', content: m.content }));
}

// ─── Lightweight Markdown renderer ───────────────────────────────────────────
// Covers the subset LLMs typically output: bold, italic, inline code,
// bullet lists, numbered lists, headings, and paragraphs. No deps.

type Segment = { text: string; bold?: boolean; italic?: boolean; code?: boolean };

type Block =
  | { type: 'paragraph'; content: string }
  | { type: 'bullet';    content: string }
  | { type: 'ordered';   content: string; num: number }
  | { type: 'heading';   content: string; level: number }
  | { type: 'spacer' };

function parseBlocks(md: string): Block[] {
  const blocks: Block[] = [];
  const lines = md.split('\n');

  for (const line of lines) {
    if (line.trim() === '') {
      if (blocks.length > 0 && blocks[blocks.length - 1].type !== 'spacer') {
        blocks.push({ type: 'spacer' });
      }
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)/);
    if (heading) {
      blocks.push({ type: 'heading', content: heading[2], level: heading[1].length });
      continue;
    }

    const bullet = line.match(/^[*\-•]\s+(.+)/);
    if (bullet) {
      blocks.push({ type: 'bullet', content: bullet[1] });
      continue;
    }

    // Use the number the LLM wrote — avoids reset bugs when blank lines
    // separate list items (a very common LLM formatting pattern).
    const ordered = line.match(/^(\d+)\.\s+(.+)/);
    if (ordered) {
      blocks.push({ type: 'ordered', content: ordered[2], num: parseInt(ordered[1], 10) });
      continue;
    }

    blocks.push({ type: 'paragraph', content: line });
  }

  // Drop trailing spacer
  if (blocks.at(-1)?.type === 'spacer') blocks.pop();
  return blocks;
}

function parseInline(text: string): Segment[] {
  const out: Segment[] = [];
  const re = /\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`/gs;
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ text: m[1], bold: true });
    else if (m[2] !== undefined) out.push({ text: m[2], italic: true });
    else if (m[3] !== undefined) out.push({ text: m[3], code: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out.length ? out : [{ text }];
}

function InlineText({ content, style }: { content: string; style: object }) {
  const segments = parseInline(content);
  return (
    <Text style={style} selectable>
      {segments.map((seg, i) => (
        <Text
          key={i}
          style={{
            fontWeight: seg.bold ? '700' : '400',
            fontStyle:  seg.italic ? 'italic' : 'normal',
            fontFamily: seg.code ? 'SpaceMono' : undefined,
          }}
        >
          {seg.text}
        </Text>
      ))}
    </Text>
  );
}

function AssistantMarkdown({ content, isDark }: { content: string; isDark: boolean }) {
  const color     = isDark ? '#ffffff' : '#111827';
  const baseStyle = { fontSize: 14, lineHeight: 21, color } as const;
  const blocks    = parseBlocks(content);

  return (
    <View>
      {blocks.map((block, i) => {
        switch (block.type) {
          case 'heading':
            return (
              <InlineText
                key={i}
                content={block.content}
                style={{
                  ...baseStyle,
                  fontSize:    block.level === 1 ? 17 : block.level === 2 ? 15 : 14,
                  fontWeight:  '700',
                  marginTop:   i > 0 ? 6 : 0,
                  marginBottom: 2,
                }}
              />
            );
          case 'bullet':
            return (
              <View key={i} style={{ flexDirection: 'row', marginBottom: 3, paddingLeft: 2 }}>
                <Text style={{ ...baseStyle, marginRight: 6 }}>•</Text>
                <InlineText content={block.content} style={{ ...baseStyle, flex: 1 }} />
              </View>
            );
          case 'ordered':
            return (
              <View key={i} style={{ flexDirection: 'row', marginBottom: 3, paddingLeft: 2 }}>
                <Text style={{ ...baseStyle, marginRight: 6, minWidth: 18 }}>{block.num}.</Text>
                <InlineText content={block.content} style={{ ...baseStyle, flex: 1 }} />
              </View>
            );
          case 'spacer':
            return <View key={i} style={{ height: 8 }} />;
          default: // paragraph
            return <InlineText key={i} content={block.content} style={baseStyle} />;
        }
      })}
    </View>
  );
}

// ─── Message bubble ───────────────────────────────────────────────────────────

function MessageBubble({ message }: { message: DisplayMessage }) {
  const isUser = message.role === 'user';
  const isDark = useColorScheme() === 'dark';

  return (
    <View className={`px-4 py-1 ${isUser ? 'items-end' : 'items-start'}`}>
      <View
        className={[
          'max-w-[80%] px-4 py-3',
          isUser
            ? 'bg-primary-600 rounded-tl-2xl rounded-bl-2xl rounded-tr-sm'
            : 'bg-gray-100 dark:bg-gray-800 rounded-tr-2xl rounded-br-2xl rounded-tl-sm',
        ].join(' ')}
      >
        {isUser ? (
          <Text className="text-sm leading-relaxed text-white" selectable>
            {message.content}
          </Text>
        ) : message.isStreaming ? (
          // Plain text during streaming — partial markdown breaks the parser
          <Text
            style={{ fontSize: 14, lineHeight: 21, color: isDark ? '#ffffff' : '#111827' }}
            selectable
          >
            {message.content || '…'}
            {message.content ? '▌' : ''}
          </Text>
        ) : (
          <AssistantMarkdown content={message.content} isDark={isDark} />
        )}
      </View>
    </View>
  );
}

// ─── Main screen ─────────────────────────────────────────────────────────────

export default function ChatThreadScreen() {
  const { id: sessionId } = useLocalSearchParams<{ id: string }>();
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [title, setTitle]       = useState<string>('Chat');
  const [input, setInput]       = useState('');
  const [sending, setSending]   = useState(false);
  const [loading, setLoading]   = useState(true);
  const flatListRef = useRef<FlatList<DisplayMessage>>(null);

  // Load existing messages and session title
  useEffect(() => {
    if (!sessionId) return;
    (async () => {
      try {
        const [session, history] = await Promise.all([
          getChatSession(sessionId),
          getChatMessages(sessionId),
        ]);
        if (session?.title) setTitle(session.title);
        setMessages(toDisplayMessages(history as ChatMessage[]));
      } finally {
        setLoading(false);
      }
    })();
  }, [sessionId]);

  // Scroll to end when messages change
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages]);

  async function handleSend() {
    const text = input.trim();
    if (!text || sending) return;

    setInput('');
    setSending(true);

    const userBubble: DisplayMessage     = { id: `user-${Date.now()}`, role: 'user',      content: text };
    const streamingBubble: DisplayMessage = { id: STREAMING_ID,         role: 'assistant', content: '', isStreaming: true };

    setMessages(prev => [...prev, userBubble, streamingBubble]);

    try {
      await sendMessage({
        sessionId,
        userMessage: text,
        onChunk: (chunk) => {
          if (chunk.delta) {
            setMessages(prev =>
              prev.map(m => m.id === STREAMING_ID ? { ...m, content: m.content + chunk.delta } : m)
            );
          }
        },
      });

      // Replace streaming bubble in-place — content is already in state from onChunk,
      // so no DB reload needed. Fetch title in parallel (auto-set after first message).
      const [fresh, session] = await Promise.all([
        getChatMessages(sessionId),
        getChatSession(sessionId),
      ]);
      setMessages(toDisplayMessages(fresh as ChatMessage[]));
      if (session?.title) setTitle(session.title);
    } catch (e: unknown) {
      setMessages(prev => prev.filter(m => m.id !== STREAMING_ID));
      Alert.alert('Error', (e as Error).message ?? 'Failed to send message');
    } finally {
      setSending(false);
    }
  }

  function handleDelete() {
    Alert.alert(
      'Delete conversation',
      'This will permanently delete this conversation and all messages.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteChatSession(sessionId);
            router.back();
          },
        },
      ]
    );
  }

  const headerHeight = useHeaderHeight();
  const canSend = input.trim().length > 0 && !sending;

  return (
    <>
      <Stack.Screen
        options={{
          title,
          headerBackTitle: 'Chats',
          headerRight: () => (
            <Pressable onPress={handleDelete} className="px-2 active:opacity-50">
              <FontAwesome name="trash-o" size={20} color="#ef4444" />
            </Pressable>
          ),
        }}
      />
      <SafeAreaView className="flex-1 bg-white dark:bg-gray-950" edges={['bottom']}>
        <KeyboardAvoidingView
          className="flex-1"
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={headerHeight}
        >
          {loading ? (
            <View className="flex-1 items-center justify-center">
              <ActivityIndicator />
            </View>
          ) : (
            <FlatList
              ref={flatListRef}
              data={messages}
              keyExtractor={m => m.id}
              renderItem={({ item }) => <MessageBubble message={item} />}
              contentContainerStyle={{ paddingVertical: 12 }}
              ListEmptyComponent={
                <View className="flex-1 items-center justify-center px-8 py-16">
                  <Text className="text-4xl mb-3">🩺</Text>
                  <Text className="text-base font-semibold text-gray-700 dark:text-gray-300 mb-1 text-center">
                    Ask about your records
                  </Text>
                  <Text className="text-sm text-gray-500 dark:text-gray-500 text-center">
                    Your complete health records are available — ask anything.
                  </Text>
                </View>
              }
              onContentSizeChange={() =>
                flatListRef.current?.scrollToEnd({ animated: false })
              }
            />
          )}

          <View className="flex-row items-end px-4 py-3 border-t border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-950 gap-3">
            <TextInput
              className="flex-1 bg-gray-100 dark:bg-gray-800 rounded-2xl px-4 py-3 text-sm text-gray-900 dark:text-white max-h-32"
              placeholder="Ask about your health records…"
              placeholderTextColor="#9ca3af"
              value={input}
              onChangeText={setInput}
              multiline
              returnKeyType="default"
              editable={!sending}
            />
            <Pressable
              className={[
                'w-10 h-10 rounded-full items-center justify-center',
                canSend ? 'bg-primary-600' : 'bg-gray-200 dark:bg-gray-700',
              ].join(' ')}
              onPress={handleSend}
              disabled={!canSend}
            >
              {sending
                ? <ActivityIndicator size="small" color={canSend ? 'white' : '#9ca3af'} />
                : <FontAwesome name="send" size={15} color={canSend ? 'white' : '#9ca3af'} />}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </>
  );
}
