import { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TextInput, Pressable, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import {
  getSecureItem, setSecureItem, deleteSecureItem, SecureKeys,
} from '~/utils/secure-store';
import { providerRegistry } from '~/llm/provider-registry';
import { logEvent } from '~/db/repositories/audit.repository';
import { setSetting } from '~/db/repositories/settings.repository';
import { OpenAIProvider } from '~/llm/providers/openai.provider';
import { AnthropicProvider } from '~/llm/providers/anthropic.provider';
import { GeminiProvider } from '~/llm/providers/gemini.provider';

const DEFAULT_MODEL: Record<Provider, string> = {
  openai:    'gpt-4o-mini',
  anthropic: 'claude-3-5-haiku-latest',
  gemini:    'gemini-1.5-flash',
};

type Provider = 'openai' | 'anthropic' | 'gemini';

const PROVIDERS: Array<{
  id:          Provider;
  name:        string;
  hint:        string;
  keyPrefix:   string;
  docUrl:      string;
  supportsRag: boolean;
}> = [
  {
    id:          'openai',
    name:        'OpenAI',
    hint:        'sk-...',
    keyPrefix:   'sk-',
    docUrl:      'https://platform.openai.com/api-keys',
    supportsRag: true,
  },
  {
    id:          'anthropic',
    name:        'Anthropic',
    hint:        'sk-ant-...',
    keyPrefix:   'sk-ant-',
    docUrl:      'https://console.anthropic.com/settings/keys',
    supportsRag: false,
  },
  {
    id:          'gemini',
    name:        'Google Gemini',
    hint:        'AIza...',
    keyPrefix:   'AIza',
    docUrl:      'https://aistudio.google.com/app/apikey',
    supportsRag: true,
  },
];

const SECURE_KEY_MAP: Record<Provider, typeof SecureKeys[keyof typeof SecureKeys]> = {
  openai:    SecureKeys.OPENAI_API_KEY,
  anthropic: SecureKeys.ANTHROPIC_API_KEY,
  gemini:    SecureKeys.GEMINI_API_KEY,
};

export default function ApiKeysScreen() {
  const [keys, setKeys]           = useState<Partial<Record<Provider, string>>>({});
  const [inputs, setInputs]       = useState<Partial<Record<Provider, string>>>({});
  const [saving, setSaving]       = useState<Provider | null>(null);
  const [validating, setValidating] = useState<Provider | null>(null);

  useEffect(() => {
    loadExistingKeys();
  }, []);

  async function loadExistingKeys() {
    const loaded: Partial<Record<Provider, string>> = {};
    for (const p of PROVIDERS) {
      const key = await getSecureItem(SECURE_KEY_MAP[p.id]);
      if (key) loaded[p.id] = key;
    }
    setKeys(loaded);
  }

  async function handleSave(provider: Provider) {
    const input = inputs[provider]?.trim();
    if (!input) return;

    setSaving(provider);
    setValidating(provider);

    try {
      const TempProviders = { openai: OpenAIProvider, anthropic: AnthropicProvider, gemini: GeminiProvider };
      const temp = new TempProviders[provider](input);
      const valid = await temp.validateKey(input);

      if (!valid) {
        Alert.alert('Invalid Key', `The API key doesn't appear to be valid for ${provider}. Check and try again.`);
        return;
      }

      await setSecureItem(SECURE_KEY_MAP[provider], input);
      providerRegistry.invalidate(provider);

      // Make this the active provider so ingestion uses it immediately
      await setSetting('active_provider', provider);
      await setSetting('active_model', DEFAULT_MODEL[provider]);

      setKeys((k) => ({ ...k, [provider]: input }));
      setInputs((i) => ({ ...i, [provider]: '' }));

      await logEvent({ eventType: 'api_key_set', metadata: { provider } });
      Alert.alert('Saved', `${PROVIDERS.find((p) => p.id === provider)?.name} API key saved successfully.`);
    } catch {
      Alert.alert('Error', 'Could not validate or save the key. Check your connection and try again.');
    } finally {
      setSaving(null);
      setValidating(null);
    }
  }

  async function handleRemove(provider: Provider) {
    Alert.alert(
      'Remove Key',
      `Remove the ${PROVIDERS.find((p) => p.id === provider)?.name} API key?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            await deleteSecureItem(SECURE_KEY_MAP[provider]);
            providerRegistry.invalidate(provider);
            setKeys((k) => { const n = { ...k }; delete n[provider]; return n; });
            await logEvent({ eventType: 'api_key_removed', metadata: { provider } });
          },
        },
      ]
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'API Keys' }} />
      <SafeAreaView className="flex-1 bg-gray-50 dark:bg-gray-950" edges={['bottom']}>
        <ScrollView className="flex-1">
          <Text className="text-sm text-gray-500 dark:text-gray-400 px-4 pt-5 pb-3">
            Your API keys are stored in the iOS Keychain and never leave this device.
            Queries go directly from your phone to the provider using your own account.
          </Text>

          {PROVIDERS.map((provider) => {
            const hasKey = !!keys[provider.id];

            return (
              <View key={provider.id} className="mx-4 mb-4 bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 overflow-hidden">
                {/* Header */}
                <View className="flex-row items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
                  <View>
                    <Text className="font-semibold text-gray-900 dark:text-white">
                      {provider.name}
                    </Text>
                    {provider.supportsRag && (
                      <Text className="text-xs text-primary-600 dark:text-primary-400 mt-0.5">
                        Supports Smart Search (RAG)
                      </Text>
                    )}
                  </View>
                  {hasKey && (
                    <View className="flex-row items-center gap-2">
                      <View className="w-2 h-2 rounded-full bg-health-green" />
                      <Text className="text-sm text-health-green font-medium">Active</Text>
                    </View>
                  )}
                </View>

                {/* Current key display */}
                {hasKey && (
                  <View className="px-4 py-3 flex-row items-center justify-between border-b border-gray-100 dark:border-gray-800">
                    <Text className="text-sm text-gray-500 dark:text-gray-400 font-mono">
                      {maskKey(keys[provider.id]!)}
                    </Text>
                    <Pressable
                      onPress={() => handleRemove(provider.id)}
                      className="px-3 py-1.5 rounded-lg bg-red-50 dark:bg-red-950 active:opacity-70"
                    >
                      <Text className="text-sm text-red-600 dark:text-red-400 font-medium">
                        Remove
                      </Text>
                    </Pressable>
                  </View>
                )}

                {/* Input */}
                <View className="px-4 py-3">
                  <TextInput
                    className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2.5 text-gray-900 dark:text-white font-mono text-sm"
                    placeholder={`Paste ${provider.hint}`}
                    placeholderTextColor="#9ca3af"
                    value={inputs[provider.id] ?? ''}
                    onChangeText={(v) => setInputs((i) => ({ ...i, [provider.id]: v }))}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <Pressable
                    onPress={() => handleSave(provider.id)}
                    disabled={!inputs[provider.id]?.trim() || saving === provider.id}
                    className="mt-2 bg-primary-600 rounded-lg py-2.5 items-center active:opacity-80 disabled:opacity-40"
                  >
                    {saving === provider.id ? (
                      <ActivityIndicator size="small" color="white" />
                    ) : (
                      <Text className="text-white font-semibold text-sm">
                        {hasKey ? 'Update Key' : 'Save Key'}
                      </Text>
                    )}
                  </Pressable>
                  <Text className="text-xs text-gray-400 dark:text-gray-600 mt-2">
                    Get your key at {provider.docUrl}
                  </Text>
                </View>
              </View>
            );
          })}

          <Text className="text-xs text-gray-400 dark:text-gray-600 text-center px-8 py-6">
            Keys are stored with iOS Keychain protection level{'\n'}
            "When Unlocked, This Device Only" — they do not sync to iCloud{'\n'}
            and will not transfer to a new device.
          </Text>
        </ScrollView>
      </SafeAreaView>
    </>
  );
}

function maskKey(key: string): string {
  if (key.length <= 8) return '••••••••';
  return key.slice(0, 6) + '••••••••' + key.slice(-4);
}
