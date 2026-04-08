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
import { clearModelCache } from '~/llm/chat.service';
import { logEvent } from '~/db/repositories/audit.repository';
import { getSetting, setSetting } from '~/db/repositories/settings.repository';
import { OpenAIProvider } from '~/llm/providers/openai.provider';
import { AnthropicProvider } from '~/llm/providers/anthropic.provider';
import { GeminiProvider } from '~/llm/providers/gemini.provider';
import { CustomProvider } from '~/llm/providers/custom.provider';
import {
  DEFAULT_MODELS,
  type LLMProviderName,
} from '~/llm/types';

// ─── Provider metadata ────────────────────────────────────────────────────────

const PROVIDER_META: Record<LLMProviderName, {
  label:   string;
  hint:    string;
  docUrl:  string;
  subtitle: string;
}> = {
  openai: {
    label:    'OpenAI',
    hint:     'sk-...',
    docUrl:   'https://platform.openai.com/api-keys',
    subtitle: 'GPT-4o, GPT-4o mini',
  },
  anthropic: {
    label:    'Anthropic',
    hint:     'sk-ant-...',
    docUrl:   'https://console.anthropic.com/settings/keys',
    subtitle: 'Claude 3.5, Claude 3 Haiku',
  },
  gemini: {
    label:    'Google',
    hint:     'AIza...',
    docUrl:   'https://aistudio.google.com/app/apikey',
    subtitle: 'Gemini 2.0, Gemini 1.5',
  },
  custom: {
    label:    'Custom',
    hint:     'API key...',
    docUrl:   '',
    subtitle: 'OpenAI-compatible',
  },
};

const PROVIDER_ORDER: LLMProviderName[] = ['openai', 'anthropic', 'gemini', 'custom'];

// ─── Types ────────────────────────────────────────────────────────────────────

type ConfigStep = 'view' | 'select' | 'key-input' | 'model-pick';

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ApiKeysScreen() {
  const [step,              setStep]              = useState<ConfigStep>('select');
  const [loading,           setLoading]           = useState(true);

  // current active config (view step)
  const [activeProvider,    setActiveProvider]    = useState<LLMProviderName | null>(null);
  const [activeModel,       setActiveModel]       = useState<string>('');
  const [activeKey,         setActiveKey]         = useState<string>('');

  // in-progress config (key-input / model-pick steps)
  const [selectedProvider,  setSelectedProvider]  = useState<LLMProviderName | null>(null);
  const [apiKeyInput,       setApiKeyInput]       = useState('');
  const [baseUrlInput,      setBaseUrlInput]      = useState('');
  const [validating,        setValidating]        = useState(false);
  const [validationError,   setValidationError]   = useState<string | null>(null);
  const [availableModels,   setAvailableModels]   = useState<string[]>([]);
  const [allowManualModel,  setAllowManualModel]  = useState(false);
  const [manualModel,       setManualModel]       = useState('');
  const [selectedModel,     setSelectedModel]     = useState<string | null>(null);
  const [saving,            setSaving]            = useState(false);
  const [editingModel,      setEditingModel]      = useState(false); // entered model-pick via Edit
  const [keyChanged,        setKeyChanged]        = useState(false); // key input differs from stored key
  const [refreshingModels,  setRefreshingModels]  = useState(false);

  useEffect(() => {
    loadCurrentConfig();
  }, []);

  async function loadCurrentConfig() {
    setLoading(true);
    try {
      const key = await getSecureItem(SecureKeys.ACTIVE_API_KEY);
      if (key) {
        const [provider, model] = await Promise.all([
          getSetting('active_provider') as Promise<LLMProviderName>,
          getSetting('active_model'),
        ]);
        setActiveProvider(provider);
        setActiveModel(model);
        setActiveKey(key);
        setStep('view');
      } else {
        setStep('select');
      }
    } finally {
      setLoading(false);
    }
  }

  // ─── View step ─────────────────────────────────────────────────────────────

  async function handleEdit() {
    if (!activeProvider || !activeKey) return;
    setValidating(true);
    try {
      // Re-use the stored key — jump straight to model picker
      setSelectedProvider(activeProvider);
      setApiKeyInput(activeKey);
      setValidationError(null);
      setManualModel('');

      let baseUrl = '';
      if (activeProvider === 'custom') {
        baseUrl = await getSetting('custom_base_url');
        setBaseUrlInput(baseUrl);
      }

      let temp;
      switch (activeProvider) {
        case 'openai':    temp = new OpenAIProvider(activeKey); break;
        case 'anthropic': temp = new AnthropicProvider(activeKey); break;
        case 'gemini':    temp = new GeminiProvider(activeKey); break;
        case 'custom':    temp = new CustomProvider(activeKey, baseUrl); break;
      }
      const models = await temp.listModels();
      setAvailableModels(models);
      setAllowManualModel(models.length === 0);
      setSelectedModel(activeModel);
      setEditingModel(true);
      setStep('model-pick');
    } catch {
      setEditingModel(false);
      // Fall back to full flow if fetching models fails
      setSelectedProvider(activeProvider);
      setApiKeyInput('');
      setAvailableModels([]);
      setAllowManualModel(false);
      setSelectedModel(activeModel);
      setStep('select');
    } finally {
      setValidating(false);
    }
  }

  function handleRemove() {
    const providerLabel = activeProvider ? PROVIDER_META[activeProvider].label : 'this';
    Alert.alert(
      'Remove Configuration',
      `Remove the ${providerLabel} configuration? You will need to re-enter your API key to use AI features.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            await deleteSecureItem(SecureKeys.ACTIVE_API_KEY);
            if (activeProvider === 'custom') {
              await setSetting('custom_base_url', '');
            }
            providerRegistry.invalidate();
            clearModelCache();
            await logEvent({ eventType: 'api_key_removed', metadata: { provider: activeProvider } });
            setActiveProvider(null);
            setActiveModel('');
            setActiveKey('');
            setStep('select');
          },
        },
      ]
    );
  }

  // ─── Select step ───────────────────────────────────────────────────────────

  function handleSelectProvider(p: LLMProviderName) {
    setSelectedProvider(p);
    setApiKeyInput('');
    setBaseUrlInput('');
    setValidationError(null);
    setStep('key-input');
  }

  // ─── Key-input step ────────────────────────────────────────────────────────

  async function handleValidate() {
    if (!selectedProvider || !apiKeyInput.trim()) return;
    setValidating(true);
    setValidationError(null);

    try {
      const tempProviders = {
        openai:    () => new OpenAIProvider(apiKeyInput.trim()),
        anthropic: () => new AnthropicProvider(apiKeyInput.trim()),
        gemini:    () => new GeminiProvider(apiKeyInput.trim()),
        custom:    () => new CustomProvider(apiKeyInput.trim(), baseUrlInput.trim()),
      };
      const temp = tempProviders[selectedProvider]();

      const valid = await temp.validateKey(apiKeyInput.trim());
      if (!valid) {
        setValidationError("Key doesn't appear to be valid. Check and try again.");
        return;
      }

      const models = await temp.listModels();
      setAvailableModels(models);
      setAllowManualModel(models.length === 0);

      // Pre-select: previously active model if it appears in the list, else default
      const preferred = activeModel && models.includes(activeModel)
        ? activeModel
        : (models.find((m) => m === DEFAULT_MODELS[selectedProvider]) ?? models[0] ?? null);
      setSelectedModel(preferred);
      setManualModel('');
      setEditingModel(false);
      setStep('model-pick');
    } catch {
      setValidationError('Could not reach the provider. Check your connection and try again.');
    } finally {
      setValidating(false);
    }
  }

  // ─── Model-pick step ───────────────────────────────────────────────────────

  async function handleRefreshModels() {
    if (!selectedProvider || !apiKeyInput.trim()) return;
    setRefreshingModels(true);
    setValidationError(null);
    try {
      let temp;
      switch (selectedProvider) {
        case 'openai':    temp = new OpenAIProvider(apiKeyInput.trim()); break;
        case 'anthropic': temp = new AnthropicProvider(apiKeyInput.trim()); break;
        case 'gemini':    temp = new GeminiProvider(apiKeyInput.trim()); break;
        case 'custom':    temp = new CustomProvider(apiKeyInput.trim(), baseUrlInput.trim()); break;
      }
      const valid = await temp.validateKey(apiKeyInput.trim());
      if (!valid) {
        setValidationError("Key doesn't appear to be valid.");
        return;
      }
      const models = await temp.listModels();
      setAvailableModels(models);
      setAllowManualModel(models.length === 0);
      setKeyChanged(false);
    } catch {
      setValidationError('Could not reach the provider. Check your connection.');
    } finally {
      setRefreshingModels(false);
    }
  }

  async function handleSave() {
    if (!selectedProvider) return;
    const modelToSave = allowManualModel ? manualModel.trim() : selectedModel;
    if (!modelToSave) return;

    setSaving(true);
    try {
      // If the key was changed in edit mode but not refreshed, validate it now
      if (keyChanged) {
        let temp;
        switch (selectedProvider) {
          case 'openai':    temp = new OpenAIProvider(apiKeyInput.trim()); break;
          case 'anthropic': temp = new AnthropicProvider(apiKeyInput.trim()); break;
          case 'gemini':    temp = new GeminiProvider(apiKeyInput.trim()); break;
          case 'custom':    temp = new CustomProvider(apiKeyInput.trim(), baseUrlInput.trim()); break;
        }
        const valid = await temp.validateKey(apiKeyInput.trim());
        if (!valid) {
          setValidationError("Key doesn't appear to be valid. Check and try again.");
          return;
        }
      }

      await setSecureItem(SecureKeys.ACTIVE_API_KEY, apiKeyInput.trim());
      await setSetting('active_provider', selectedProvider);
      await setSetting('active_model', modelToSave);

      if (selectedProvider === 'custom') {
        await setSetting('custom_base_url', baseUrlInput.trim());
      }

      providerRegistry.invalidate();
      clearModelCache();

      await logEvent({ eventType: 'api_key_set', metadata: { provider: selectedProvider } });

      setActiveProvider(selectedProvider);
      setActiveModel(modelToSave);
      setActiveKey(apiKeyInput.trim());
      setKeyChanged(false);
      setEditingModel(false);
      setStep('view');
    } catch {
      Alert.alert('Error', 'Could not save the configuration. Try again.');
    } finally {
      setSaving(false);
    }
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <>
        <Stack.Screen options={{ title: 'AI Provider' }} />
        <SafeAreaView className="flex-1 bg-gray-50 dark:bg-gray-950 items-center justify-center" edges={['bottom']}>
          <ActivityIndicator size="large" />
        </SafeAreaView>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'AI Provider' }} />
      <SafeAreaView className="flex-1 bg-gray-50 dark:bg-gray-950" edges={['bottom']}>
        <ScrollView className="flex-1" keyboardShouldPersistTaps="handled">

          {/* ── View: current config ── */}
          {step === 'view' && activeProvider && (
            <View className="px-4 pt-5">
              <Text className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                Your API key is stored in the iOS Keychain and never leaves this device.
              </Text>

              <View className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 overflow-hidden">
                <View className="px-4 py-4 border-b border-gray-100 dark:border-gray-800">
                  <View className="flex-row items-center gap-3">
                    <View className="w-2.5 h-2.5 rounded-full bg-health-green" />
                    <Text className="font-semibold text-gray-900 dark:text-white text-base">
                      {PROVIDER_META[activeProvider].label}
                    </Text>
                  </View>
                </View>

                <View className="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
                  <Text className="text-xs text-gray-400 dark:text-gray-500 mb-1 uppercase tracking-wide">API Key</Text>
                  <Text className="text-sm text-gray-700 dark:text-gray-300 font-mono">
                    {maskKey(activeKey)}
                  </Text>
                </View>

                <View className="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
                  <Text className="text-xs text-gray-400 dark:text-gray-500 mb-1 uppercase tracking-wide">Model</Text>
                  <Text className="text-sm text-gray-700 dark:text-gray-300 font-mono">
                    {activeModel}
                  </Text>
                </View>

                <View className="px-4 py-3 flex-row gap-3">
                  <Pressable
                    onPress={handleEdit}
                    disabled={validating}
                    className="flex-1 bg-primary-600 rounded-lg py-2.5 items-center active:opacity-80 disabled:opacity-60"
                  >
                    {validating
                      ? <ActivityIndicator size="small" color="white" />
                      : <Text className="text-white font-semibold text-sm">Edit</Text>
                    }
                  </Pressable>
                  <Pressable
                    onPress={handleRemove}
                    className="flex-1 bg-red-50 dark:bg-red-950 rounded-lg py-2.5 items-center active:opacity-80"
                  >
                    <Text className="text-red-600 dark:text-red-400 font-semibold text-sm">Remove</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          )}

          {/* ── Select: provider picker ── */}
          {step === 'select' && (
            <View className="px-4 pt-5">
              <Text className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                Choose a provider. Your API key is stored on-device in the iOS Keychain.
              </Text>

              <View className="flex-row flex-wrap gap-3">
                {PROVIDER_ORDER.map((p) => {
                  const meta = PROVIDER_META[p];
                  return (
                    <Pressable
                      key={p}
                      onPress={() => handleSelectProvider(p)}
                      className="flex-1 min-w-[44%] bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl p-4 active:opacity-70"
                    >
                      <Text className="font-semibold text-gray-900 dark:text-white text-base mb-1">
                        {meta.label}
                      </Text>
                      <Text className="text-xs text-gray-400 dark:text-gray-500">
                        {meta.subtitle}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}

          {/* ── Key input ── */}
          {step === 'key-input' && selectedProvider && (
            <View className="px-4 pt-5">
              <Pressable onPress={() => setStep('select')} className="mb-4">
                <Text className="text-primary-600 dark:text-primary-400 text-sm">← {PROVIDER_META[selectedProvider].label}</Text>
              </Pressable>

              <View className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 overflow-hidden">
                <View className="px-4 py-4">
                  <Text className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    API Key
                  </Text>
                  <TextInput
                    className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2.5 text-gray-900 dark:text-white font-mono text-sm"
                    placeholder={`Paste ${PROVIDER_META[selectedProvider].hint}`}
                    placeholderTextColor="#9ca3af"
                    value={apiKeyInput}
                    onChangeText={(v) => { setApiKeyInput(v); setValidationError(null); }}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="off"
                    spellCheck={false}
                  />

                  {selectedProvider === 'custom' && (
                    <>
                      <Text className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 mt-4">
                        Base URL
                      </Text>
                      <TextInput
                        className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2.5 text-gray-900 dark:text-white font-mono text-sm"
                        placeholder="https://your-server.com/v1"
                        placeholderTextColor="#9ca3af"
                        value={baseUrlInput}
                        onChangeText={(v) => { setBaseUrlInput(v); setValidationError(null); }}
                        autoCapitalize="none"
                        autoCorrect={false}
                        keyboardType="url"
                      />
                    </>
                  )}

                  {validationError && (
                    <Text className="text-sm text-red-600 dark:text-red-400 mt-2">
                      {validationError}
                    </Text>
                  )}

                  <Pressable
                    onPress={handleValidate}
                    disabled={
                      validating ||
                      !apiKeyInput.trim() ||
                      (selectedProvider === 'custom' && !baseUrlInput.trim())
                    }
                    className="mt-4 bg-primary-600 rounded-lg py-2.5 items-center active:opacity-80 disabled:opacity-40"
                  >
                    {validating ? (
                      <ActivityIndicator size="small" color="white" />
                    ) : (
                      <Text className="text-white font-semibold text-sm">Validate & Continue</Text>
                    )}
                  </Pressable>

                  {PROVIDER_META[selectedProvider].docUrl !== '' && (
                    <Text className="text-xs text-gray-400 dark:text-gray-600 mt-3 text-center">
                      Get your key at {PROVIDER_META[selectedProvider].docUrl}
                    </Text>
                  )}
                </View>
              </View>
            </View>
          )}

          {/* ── Model pick ── */}
          {step === 'model-pick' && selectedProvider && (
            <View className="px-4 pt-5">
              <Pressable
                onPress={() => editingModel ? setStep('view') : setStep('key-input')}
                className="mb-4"
              >
                <Text className="text-primary-600 dark:text-primary-400 text-sm">
                  {editingModel ? '← Cancel' : '← Key'}
                </Text>
              </Pressable>

              {/* API key field — shown when editing an existing config */}
              {editingModel && (
                <View className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 overflow-hidden mb-4">
                  <View className="px-4 py-4">
                    <Text className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      API Key
                    </Text>
                    <TextInput
                      className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2.5 text-gray-900 dark:text-white font-mono text-sm"
                      placeholder={`Paste ${PROVIDER_META[selectedProvider].hint}`}
                      placeholderTextColor="#9ca3af"
                      value={apiKeyInput}
                      onChangeText={(v) => {
                        setApiKeyInput(v);
                        setKeyChanged(v.trim() !== activeKey);
                        setValidationError(null);
                      }}
                      autoCapitalize="none"
                      autoCorrect={false}
                      autoComplete="off"
                      spellCheck={false}
                    />
                    {keyChanged && (
                      <Pressable
                        onPress={handleRefreshModels}
                        disabled={refreshingModels || !apiKeyInput.trim()}
                        className="mt-2 border border-primary-600 rounded-lg py-2 items-center active:opacity-70 disabled:opacity-40"
                      >
                        {refreshingModels
                          ? <ActivityIndicator size="small" color="#4f46e5" />
                          : <Text className="text-primary-600 dark:text-primary-400 text-sm font-medium">Validate & Refresh Models</Text>
                        }
                      </Pressable>
                    )}
                    {validationError && (
                      <Text className="text-sm text-red-600 dark:text-red-400 mt-2">{validationError}</Text>
                    )}
                  </View>
                </View>
              )}

              <Text className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                Select a model
              </Text>

              <View className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 overflow-hidden mb-4">
                {allowManualModel ? (
                  <View className="px-4 py-4">
                    <Text className="text-sm text-gray-500 dark:text-gray-400 mb-3">
                      This endpoint didn't return a model list. Enter the model name manually.
                    </Text>
                    <TextInput
                      className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2.5 text-gray-900 dark:text-white font-mono text-sm"
                      placeholder="e.g. llama3.2"
                      placeholderTextColor="#9ca3af"
                      value={manualModel}
                      onChangeText={setManualModel}
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                  </View>
                ) : (
                  availableModels.map((model, i) => {
                    const isSelected = selectedModel === model;
                    const isLast = i === availableModels.length - 1;
                    return (
                      <Pressable
                        key={model}
                        onPress={() => setSelectedModel(model)}
                        className={`flex-row items-center justify-between px-4 py-3.5 active:bg-gray-50 dark:active:bg-gray-800 ${!isLast ? 'border-b border-gray-100 dark:border-gray-800' : ''}`}
                      >
                        <Text className={`text-sm font-mono ${isSelected ? 'text-primary-600 dark:text-primary-400 font-semibold' : 'text-gray-700 dark:text-gray-300'}`}>
                          {model}
                        </Text>
                        {isSelected && (
                          <Text className="text-primary-600 dark:text-primary-400 font-bold text-base">✓</Text>
                        )}
                      </Pressable>
                    );
                  })
                )}
              </View>

              <Pressable
                onPress={handleSave}
                disabled={saving || (allowManualModel ? !manualModel.trim() : !selectedModel)}
                className="bg-primary-600 rounded-lg py-3 items-center active:opacity-80 disabled:opacity-40"
              >
                {saving ? (
                  <ActivityIndicator size="small" color="white" />
                ) : (
                  <Text className="text-white font-semibold">Save Configuration</Text>
                )}
              </Pressable>
            </View>
          )}

          <Text className="text-xs text-gray-400 dark:text-gray-600 text-center px-8 py-8">
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
