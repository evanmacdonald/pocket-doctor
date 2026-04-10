import { useState, useCallback } from 'react';
import {
  View, Text, TextInput, ScrollView, Pressable,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, Stack } from 'expo-router';
import FontAwesome from '@expo/vector-icons/FontAwesome';

import { normalizeDocumentToFhir } from '~/ingestion/normalizers/fhir.normalizer';
import { upsertFhirResource } from '~/db/repositories/fhir.repository';

// ─── Resource display helpers ─────────────────────────────────────────────────

const RESOURCE_TYPE_CONFIG: Record<string, { label: string; icon: string; color: string }> = {
  Condition:           { label: 'Condition',    icon: '🫀', color: 'bg-red-50 dark:bg-red-950' },
  Observation:         { label: 'Observation',  icon: '🔬', color: 'bg-blue-50 dark:bg-blue-950' },
  MedicationStatement: { label: 'Medication',   icon: '💊', color: 'bg-purple-50 dark:bg-purple-950' },
  MedicationRequest:   { label: 'Medication',   icon: '💊', color: 'bg-purple-50 dark:bg-purple-950' },
  AllergyIntolerance:  { label: 'Allergy',      icon: '⚠️', color: 'bg-amber-50 dark:bg-amber-950' },
  Immunization:        { label: 'Immunization', icon: '💉', color: 'bg-green-50 dark:bg-green-950' },
  Procedure:           { label: 'Procedure',    icon: '🏥', color: 'bg-indigo-50 dark:bg-indigo-950' },
};

function getResourceConfig(type: string) {
  return RESOURCE_TYPE_CONFIG[type] ?? { label: type, icon: '📋', color: 'bg-gray-50 dark:bg-gray-900' };
}

type RawResource = Record<string, unknown>;

function getTitle(r: RawResource): string {
  return (
    (r.code as RawResource | undefined)?.text as string |undefined ??
    ((r.code as RawResource | undefined)?.coding as RawResource[] | undefined)?.[0]?.display as string | undefined ??
    (r.medicationCodeableConcept as RawResource | undefined)?.text as string | undefined ??
    (r.vaccineCode as RawResource | undefined)?.text as string | undefined ??
    ((r.vaccineCode as RawResource | undefined)?.coding as RawResource[] | undefined)?.[0]?.display as string | undefined ??
    r.resourceType as string
  );
}

function getSubtitle(r: RawResource, label: string): string {
  const dateCandidates = [
    'effectiveDateTime', 'recordedDate', 'onsetDateTime',
    'performedDateTime', 'occurrenceDateTime', 'date',
  ];
  let date = '';
  for (const field of dateCandidates) {
    if (typeof r[field] === 'string') { date = (r[field] as string).slice(0, 10); break; }
  }
  const status =
    ((r.clinicalStatus as RawResource | undefined)?.coding as RawResource[] | undefined)?.[0]?.code as string | undefined ??
    r.status as string | undefined;

  const parts = [label];
  if (date) parts.push(date);
  if (status) parts.push(status);
  return parts.join(' · ');
}

function extractEffectiveDate(r: RawResource): string | null {
  const candidates = [
    r.effectiveDateTime, r.recordedDate, r.onsetDateTime,
    r.performedDateTime, r.occurrenceDateTime,
    (r.effectivePeriod as RawResource | undefined)?.start,
    r.date,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c) return c.slice(0, 10);
  }
  return null;
}

// ─── Extracted resource card ──────────────────────────────────────────────────

type ExtractedItem = { resourceType: string; resource: RawResource };

function ExtractedCard({ item, onRemove }: { item: ExtractedItem; onRemove: () => void }) {
  const config = getResourceConfig(item.resourceType);
  return (
    <View className="flex-row items-center px-4 py-3 bg-white dark:bg-gray-900">
      <View className={`w-10 h-10 rounded-xl items-center justify-center mr-3 ${config.color}`}>
        <Text className="text-lg">{config.icon}</Text>
      </View>
      <View className="flex-1 mr-2">
        <Text className="text-sm font-medium text-gray-900 dark:text-white" numberOfLines={1}>
          {getTitle(item.resource)}
        </Text>
        <Text className="text-xs text-gray-500 dark:text-gray-400 mt-0.5" numberOfLines={1}>
          {getSubtitle(item.resource, config.label)}
        </Text>
      </View>
      <Pressable
        onPress={onRemove}
        hitSlop={8}
        className="w-7 h-7 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800 active:opacity-70"
      >
        <FontAwesome name="times" size={12} color="#6b7280" />
      </Pressable>
    </View>
  );
}

function Divider() {
  return <View className="h-px bg-gray-100 dark:bg-gray-800 ml-16" />;
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function DescribeRecordScreen() {
  const [text, setText]           = useState('');
  const [step, setStep]           = useState<'input' | 'review'>('input');
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving]       = useState(false);
  const [extracted, setExtracted] = useState<ExtractedItem[]>([]);

  const handleExtract = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setExtracting(true);
    try {
      const bundle = await normalizeDocumentToFhir({ rawText: trimmed });
      const items: ExtractedItem[] = ((bundle.entry ?? []) as Array<{ resource: RawResource }>)
        .map((e) => e.resource)
        .filter((r): r is RawResource => typeof r?.resourceType === 'string' && !['Patient', 'Practitioner', 'Organization', 'DiagnosticReport'].includes(r.resourceType as string))
        .map((r) => ({ resourceType: r.resourceType as string, resource: r }));

      if (items.length === 0) {
        Alert.alert(
          'No records found',
          'No health records could be extracted. Try adding more details like diagnoses, medications, or test results.'
        );
        return;
      }
      setExtracted(items);
      setStep('review');
    } catch (e) {
      Alert.alert('Extraction failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setExtracting(false);
    }
  }, [text]);

  const handleRemove = useCallback((index: number) => {
    setExtracted((prev: ExtractedItem[]) => prev.filter((_: ExtractedItem, i: number) => i !== index));
  }, []);

  const handleSave = useCallback(async () => {
    if (extracted.length === 0) return;
    setSaving(true);
    try {
      for (const item of extracted) {
        await upsertFhirResource({
          resourceType:     item.resourceType,
          resourceJson:     JSON.stringify(item.resource),
          sourceDocumentId: null,
          effectiveDate:    extractEffectiveDate(item.resource),
        });
      }
      router.back();
    } catch (e) {
      Alert.alert('Save failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setSaving(false);
    }
  }, [extracted]);

  const handleStartOver = useCallback(() => {
    setStep('input');
    setExtracted([]);
  }, []);

  return (
    <>
      <Stack.Screen options={{ title: 'Describe in Words' }} />
      <SafeAreaView className="flex-1 bg-gray-50 dark:bg-gray-950" edges={['bottom']}>

        {/* ── Step 1: text input ── */}
        {step === 'input' && (
          <KeyboardAvoidingView
            className="flex-1"
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          >
            <ScrollView
              className="flex-1"
              contentContainerStyle={{ flexGrow: 1 }}
              keyboardShouldPersistTaps="handled"
            >
              <View className="px-4 pt-6 pb-4">
                <Text className="text-base font-semibold text-gray-900 dark:text-white mb-1">
                  Describe your health record
                </Text>
                <Text className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                  Type what you remember and AI will extract the structured records for you.
                </Text>
                <TextInput
                  className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 px-4 py-3 text-sm text-gray-900 dark:text-white"
                  style={{ minHeight: 180, textAlignVertical: 'top' }}
                  multiline
                  placeholder={'e.g. I was diagnosed with Type 2 diabetes in March 2019 and started metformin 500mg twice daily'}
                  placeholderTextColor="#9ca3af"
                  value={text}
                  onChangeText={setText}
                  autoFocus
                />
              </View>
            </ScrollView>
            <View className="px-4 py-3 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-950">
              <Pressable
                onPress={handleExtract}
                disabled={extracting || !text.trim()}
                className="bg-primary-600 rounded-lg py-3 items-center active:opacity-80 disabled:opacity-40"
              >
                {extracting
                  ? <ActivityIndicator size="small" color="white" />
                  : <Text className="text-white font-semibold">Extract Records</Text>}
              </Pressable>
            </View>
          </KeyboardAvoidingView>
        )}

        {/* ── Step 2: review & save ── */}
        {step === 'review' && (
          <>
            <ScrollView className="flex-1">
              <View className="px-4 pt-6 pb-2">
                <Text className="text-base font-semibold text-gray-900 dark:text-white mb-1">
                  Review extracted records
                </Text>
                <Text className="text-sm text-gray-500 dark:text-gray-400">
                  Tap × to remove any records before saving.
                </Text>
              </View>

              {extracted.length === 0 ? (
                <View className="mx-4 mt-4 rounded-xl border border-dashed border-gray-200 dark:border-gray-700 items-center py-10">
                  <Text className="text-sm text-gray-500 dark:text-gray-400">All records removed.</Text>
                </View>
              ) : (
                <View className="mx-4 mt-4 rounded-xl overflow-hidden border border-gray-100 dark:border-gray-800">
                  {extracted.map((item: ExtractedItem, idx: number) => (
                    <View key={idx}>
                      <ExtractedCard item={item} onRemove={() => handleRemove(idx)} />
                      {idx < extracted.length - 1 && <Divider />}
                    </View>
                  ))}
                </View>
              )}

              <Pressable onPress={handleStartOver} className="items-center py-5 mt-1 active:opacity-60">
                <Text className="text-sm text-primary-600 dark:text-primary-400">Start over</Text>
              </Pressable>

              <View className="h-4" />
            </ScrollView>
            <View className="px-4 py-3 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-950">
              <Pressable
                onPress={handleSave}
                disabled={saving || extracted.length === 0}
                className="bg-primary-600 rounded-lg py-3 items-center active:opacity-80 disabled:opacity-40"
              >
                {saving
                  ? <ActivityIndicator size="small" color="white" />
                  : <Text className="text-white font-semibold">
                      Save {extracted.length} record{extracted.length !== 1 ? 's' : ''}
                    </Text>}
              </Pressable>
            </View>
          </>
        )}

      </SafeAreaView>
    </>
  );
}
