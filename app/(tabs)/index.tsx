import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, Pressable, ActivityIndicator, Alert, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import FontAwesome from '@expo/vector-icons/FontAwesome';

import { getAllFhirResources } from '~/db/repositories/fhir.repository';
import { getDatabase } from '~/db/client';
import { documents } from '~/db/schema';
import { ingestDocument } from '~/ingestion/pipeline';
import { ingestionQueue } from '~/ingestion/queue';
import type { FhirResource, Document } from '~/db/schema';
import { desc } from 'drizzle-orm';

// ─── Resource type display config ────────────────────────────────────────────

const RESOURCE_TYPE_CONFIG: Record<string, { label: string; icon: string; color: string }> = {
  Condition:            { label: 'Conditions',    icon: '🫀', color: 'bg-red-50 dark:bg-red-950' },
  Observation:          { label: 'Observations',  icon: '🔬', color: 'bg-blue-50 dark:bg-blue-950' },
  MedicationStatement:  { label: 'Medications',   icon: '💊', color: 'bg-purple-50 dark:bg-purple-950' },
  MedicationRequest:    { label: 'Medications',   icon: '💊', color: 'bg-purple-50 dark:bg-purple-950' },
  AllergyIntolerance:   { label: 'Allergies',     icon: '⚠️', color: 'bg-amber-50 dark:bg-amber-950' },
  Immunization:         { label: 'Immunizations', icon: '💉', color: 'bg-green-50 dark:bg-green-950' },
  Procedure:            { label: 'Procedures',    icon: '🏥', color: 'bg-indigo-50 dark:bg-indigo-950' },
  DiagnosticReport:     { label: 'Reports',       icon: '📄', color: 'bg-gray-50 dark:bg-gray-900' },
};

function getResourceConfig(type: string) {
  return RESOURCE_TYPE_CONFIG[type] ?? { label: type, icon: '📋', color: 'bg-gray-50 dark:bg-gray-900' };
}

// ─── Extract a human-readable title from a FHIR resource ─────────────────────

function getResourceTitle(resource: FhirResource): string {
  try {
    const r = JSON.parse(resource.resourceJson);
    return (
      r.code?.text ??
      r.code?.coding?.[0]?.display ??
      r.medicationCodeableConcept?.text ??
      r.vaccineCode?.text ??
      r.vaccineCode?.coding?.[0]?.display ??
      resource.resourceType
    );
  } catch {
    return resource.resourceType;
  }
}

function getResourceSubtitle(resource: FhirResource): string {
  const parts: string[] = [];
  if (resource.effectiveDate) parts.push(resource.effectiveDate.slice(0, 10));
  try {
    const r = JSON.parse(resource.resourceJson);
    const status =
      r.clinicalStatus?.coding?.[0]?.code ??
      r.status ??
      r.verificationStatus?.coding?.[0]?.code;
    if (status) parts.push(status);
  } catch { /* ignore */ }
  return parts.join(' · ');
}

// ─── Components ───────────────────────────────────────────────────────────────

function ResourceCard({ resource, onPress }: { resource: FhirResource; onPress: () => void }) {
  const config = getResourceConfig(resource.resourceType);
  const title = getResourceTitle(resource);
  const subtitle = getResourceSubtitle(resource);

  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center px-4 py-3 bg-white dark:bg-gray-900 active:opacity-70"
    >
      <View className={`w-10 h-10 rounded-xl items-center justify-center mr-3 ${config.color}`}>
        <Text className="text-lg">{config.icon}</Text>
      </View>
      <View className="flex-1 mr-2">
        <Text className="text-sm font-medium text-gray-900 dark:text-white" numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{subtitle}</Text>
        ) : null}
      </View>
      <FontAwesome name="chevron-right" size={12} color="#9ca3af" />
    </Pressable>
  );
}

function SectionDivider() {
  return <View className="h-px bg-gray-100 dark:bg-gray-800 ml-16" />;
}

function IngestionBanner({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <View className="mx-4 mb-3 px-4 py-3 bg-primary-50 dark:bg-primary-950 rounded-xl flex-row items-center gap-3">
      <ActivityIndicator size="small" color="#2563eb" />
      <Text className="text-sm text-primary-700 dark:text-primary-300 flex-1">
        Processing {count} document{count > 1 ? 's' : ''}…
      </Text>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function RecordsScreen() {
  const [records, setRecords]       = useState<FhirResource[]>([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [uploading, setUploading]   = useState(false);
  const [queueCount, setQueueCount] = useState(ingestionQueue.pendingCount);

  const loadRecords = useCallback(async () => {
    try {
      const rows = await getAllFhirResources(200);
      setRecords(rows);
    } catch (e) {
      console.error('Failed to load records:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadRecords();

    // Re-load when the ingestion queue drains
    const unsub = ingestionQueue.onPendingCountChange((count) => {
      setQueueCount(count);
      if (count === 0) loadRecords();
    });
    return unsub;
  }, [loadRecords]);

  const handleUploadPDF = useCallback(async () => {
    setUploading(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/*'],
        copyToCacheDirectory: true,
        multiple: false,
      });

      if (result.canceled || !result.assets?.[0]) return;

      const asset = result.assets[0];

      // Check for duplicate by filename
      const db = getDatabase();
      const existing = await db.query.documents.findFirst({
        where: (d, { eq }) => eq(d.filename, asset.name),
      });
      if (existing) {
        Alert.alert(
          'Already uploaded',
          `"${asset.name}" has already been imported.`,
          [{ text: 'OK' }]
        );
        return;
      }

      // Copy to documentDirectory so it persists
      const destDir  = `${FileSystem.documentDirectory}documents/`;
      const destPath = `${destDir}${Date.now()}_${asset.name}`;
      await FileSystem.makeDirectoryAsync(destDir, { intermediates: true });
      await FileSystem.copyAsync({ from: asset.uri, to: destPath });

      await ingestDocument({
        filename:   asset.name,
        sourceType: 'pdf_upload',
        mimeType:   asset.mimeType ?? 'application/pdf',
        filePath:   destPath,
      });

      // Show processing state immediately
      setQueueCount(ingestionQueue.pendingCount);

      Alert.alert(
        'Document queued',
        `"${asset.name}" is being processed. Records will appear shortly.`,
        [{ text: 'OK' }]
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      Alert.alert('Upload failed', msg);
    } finally {
      setUploading(false);
    }
  }, []);

  // Group records by type
  const grouped = records.reduce<Record<string, FhirResource[]>>((acc, r) => {
    const key = RESOURCE_TYPE_CONFIG[r.resourceType]?.label ?? r.resourceType;
    if (!acc[key]) acc[key] = [];
    acc[key].push(r);
    return acc;
  }, {});

  const groupEntries = Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b));
  const isEmpty = records.length === 0 && !loading;

  return (
    <SafeAreaView className="flex-1 bg-gray-50 dark:bg-gray-950" edges={['bottom']}>
      {/* Header row */}
      <View className="flex-row items-center justify-between px-4 pt-4 pb-3">
        <View>
          <Text className="text-2xl font-bold text-gray-900 dark:text-white">
            Health Records
          </Text>
          <Text className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {records.length > 0
              ? `${records.length} record${records.length !== 1 ? 's' : ''} · private & on-device`
              : 'All data stored privately on this device.'}
          </Text>
        </View>

        {/* Upload button */}
        <Pressable
          onPress={handleUploadPDF}
          disabled={uploading}
          className="w-11 h-11 rounded-full bg-primary-600 items-center justify-center shadow active:opacity-80 disabled:opacity-50"
        >
          {uploading
            ? <ActivityIndicator size="small" color="white" />
            : <FontAwesome name="plus" size={18} color="white" />}
        </Pressable>
      </View>

      {/* Processing banner */}
      <IngestionBanner count={queueCount} />

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#2563eb" />
        </View>
      ) : isEmpty ? (
        /* Empty state */
        <ScrollView
          contentContainerStyle={{ flexGrow: 1 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadRecords(); }} />}
        >
          <View className="flex-1 items-center justify-center py-24 px-8">
            <Text className="text-6xl mb-4">📋</Text>
            <Text className="text-lg font-semibold text-gray-700 dark:text-gray-300 mb-2">
              No records yet
            </Text>
            <Text className="text-gray-500 dark:text-gray-400 text-center mb-8">
              Tap the + button to upload a PDF or medical document.
            </Text>
            <Pressable
              onPress={handleUploadPDF}
              disabled={uploading}
              className="flex-row items-center gap-2 bg-primary-600 px-6 py-3 rounded-xl active:opacity-80"
            >
              <FontAwesome name="upload" size={14} color="white" />
              <Text className="text-white font-semibold">Upload Document</Text>
            </Pressable>
          </View>
        </ScrollView>
      ) : (
        /* Records list */
        <ScrollView
          className="flex-1"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadRecords(); }} />}
        >
          {groupEntries.map(([groupLabel, groupRecords]) => (
            <View key={groupLabel} className="mb-4">
              {/* Section header */}
              <Text className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider px-4 py-2">
                {groupLabel} ({groupRecords.length})
              </Text>

              {/* Section cards */}
              <View className="mx-4 rounded-xl overflow-hidden border border-gray-100 dark:border-gray-800">
                {groupRecords.map((record, idx) => (
                  <View key={record.id}>
                    <ResourceCard
                      resource={record}
                      onPress={() => router.push(`/records/${record.id}`)}
                    />
                    {idx < groupRecords.length - 1 && <SectionDivider />}
                  </View>
                ))}
              </View>
            </View>
          ))}

          <View className="h-8" />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
