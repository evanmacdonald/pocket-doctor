import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, Pressable, ActivityIndicator, Alert, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import FontAwesome from '@expo/vector-icons/FontAwesome';

import { getAllFhirResources } from '~/db/repositories/fhir.repository';
import { getDatabase } from '~/db/client';
import { documents } from '~/db/schema';
import { storeDocument, processDocument, deleteDocument } from '~/ingestion/pipeline';
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

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const configs: Record<string, { label: string; className: string }> = {
    pending:    { label: 'Not processed',  className: 'bg-gray-100 dark:bg-gray-800' },
    processing: { label: 'Processing…',    className: 'bg-blue-100 dark:bg-blue-900' },
    done:       { label: 'Processed',      className: 'bg-green-100 dark:bg-green-900' },
    failed:     { label: 'Failed',         className: 'bg-red-100 dark:bg-red-900' },
  };
  const cfg = configs[status] ?? configs.pending;
  const textColor = {
    pending:    'text-gray-600 dark:text-gray-400',
    processing: 'text-blue-700 dark:text-blue-300',
    done:       'text-green-700 dark:text-green-300',
    failed:     'text-red-700 dark:text-red-300',
  }[status] ?? 'text-gray-600';

  return (
    <View className={`px-2 py-0.5 rounded-full ${cfg.className}`}>
      <Text className={`text-xs font-medium ${textColor}`}>{cfg.label}</Text>
    </View>
  );
}

// ─── Document row ─────────────────────────────────────────────────────────────

function DocumentRow({
  doc,
  isProcessing,
  onProcess,
  onDelete,
  onView,
}: {
  doc: Document;
  isProcessing: boolean;
  onProcess: () => void;
  onDelete: () => void;
  onView: () => void;
}) {
  const canProcess = doc.ingestionStatus === 'pending' || doc.ingestionStatus === 'failed';
  const date = new Date(doc.createdAt).toLocaleDateString();

  return (
    <Pressable onPress={onView} className="px-4 py-3 bg-white dark:bg-gray-900 active:opacity-70">
      <View className="flex-row items-center gap-3">
        <View className="w-10 h-10 rounded-xl items-center justify-center bg-gray-100 dark:bg-gray-800">
          <Text className="text-lg">📄</Text>
        </View>
        <View className="flex-1 mr-2">
          <Text className="text-sm font-medium text-gray-900 dark:text-white" numberOfLines={1}>
            {doc.filename}
          </Text>
          <View className="flex-row items-center gap-2 mt-1">
            <Text className="text-xs text-gray-400 dark:text-gray-500">{date}</Text>
            <StatusBadge status={doc.ingestionStatus} />
          </View>
          {doc.ingestionStatus === 'failed' && doc.ingestionError && (
            <Text className="text-xs text-red-500 mt-0.5" numberOfLines={2}>
              {doc.ingestionError}
            </Text>
          )}
        </View>
        {canProcess && (
          <Pressable
            onPress={onProcess}
            disabled={isProcessing}
            className="px-3 py-1.5 rounded-lg bg-primary-600 active:opacity-70 disabled:opacity-40"
          >
            {isProcessing
              ? <ActivityIndicator size="small" color="white" />
              : <Text className="text-xs font-semibold text-white">Process</Text>
            }
          </Pressable>
        )}
        {doc.ingestionStatus === 'processing' && !canProcess && (
          <ActivityIndicator size="small" color="#2563eb" />
        )}
        <Pressable
          onPress={onDelete}
          className="w-8 h-8 items-center justify-center rounded-lg active:opacity-70"
          hitSlop={8}
        >
          <FontAwesome name="trash" size={15} color="#ef4444" />
        </Pressable>
      </View>
    </Pressable>
  );
}

// ─── Resource card ────────────────────────────────────────────────────────────

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

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function RecordsScreen() {
  const [docs, setDocs]             = useState<Document[]>([]);
  const [records, setRecords]       = useState<FhirResource[]>([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [uploading, setUploading]   = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [queueCount, setQueueCount] = useState(ingestionQueue.pendingCount);

  const loadData = useCallback(async () => {
    try {
      const db = getDatabase();
      const [allDocs, allRecords] = await Promise.all([
        db.query.documents.findMany({ orderBy: [desc(documents.createdAt)] }),
        getAllFhirResources(200),
      ]);
      setDocs(allDocs);
      setRecords(allRecords);
    } catch (e) {
      console.error('Failed to load:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData();

    const unsub = ingestionQueue.onPendingCountChange((count) => {
      setQueueCount(count);
      if (count === 0) {
        setProcessingId(null);
        loadData();
      }
    });
    return unsub;
  }, [loadData]);

  const handleUpload = useCallback(async () => {
    setUploading(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/*'],
        copyToCacheDirectory: true,
        multiple: false,
      });

      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];

      // Copy to permanent storage
      const destDir  = `${FileSystem.documentDirectory}documents/`;
      const destPath = `${destDir}${Date.now()}_${asset.name}`;
      await FileSystem.makeDirectoryAsync(destDir, { intermediates: true });
      await FileSystem.copyAsync({ from: asset.uri, to: destPath });

      await storeDocument({
        filename:   asset.name,
        sourceType: 'pdf_upload',
        mimeType:   asset.mimeType ?? 'application/pdf',
        filePath:   destPath,
      });

      await loadData();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      Alert.alert('Upload failed', msg);
    } finally {
      setUploading(false);
    }
  }, [loadData]);

  const handleView = useCallback(async (doc: Document) => {
    if (!doc.filePath) {
      Alert.alert('No file', 'The original file is not available.');
      return;
    }
    const available = await Sharing.isAvailableAsync();
    if (!available) {
      Alert.alert('Not available', 'File sharing is not available on this device.');
      return;
    }
    await Sharing.shareAsync(doc.filePath, {
      mimeType: doc.mimeType,
      dialogTitle: doc.filename,
    });
  }, []);

  const handleDelete = useCallback((docId: string, filename: string) => {
    Alert.alert(
      'Delete document',
      `Remove "${filename}" and all extracted records from this document?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteDocument(docId);
            await loadData();
          },
        },
      ]
    );
  }, [loadData]);

  const handleProcess = useCallback(async (docId: string) => {
    setProcessingId(docId);
    // Optimistically update status
    setDocs((prev) => prev.map((d) =>
      d.id === docId ? { ...d, ingestionStatus: 'processing' } : d
    ));
    try {
      await processDocument(docId);
      setQueueCount(ingestionQueue.pendingCount);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      Alert.alert('Process failed', msg);
      setProcessingId(null);
      await loadData();
    }
  }, [loadData]);

  // Group records by type
  const grouped = records.reduce<Record<string, FhirResource[]>>((acc, r) => {
    const key = RESOURCE_TYPE_CONFIG[r.resourceType]?.label ?? r.resourceType;
    if (!acc[key]) acc[key] = [];
    acc[key].push(r);
    return acc;
  }, {});
  const groupEntries = Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b));

  return (
    <SafeAreaView className="flex-1 bg-gray-50 dark:bg-gray-950" edges={['bottom']}>
      {/* Header */}
      <View className="flex-row items-center justify-between px-4 pt-4 pb-3">
        <View>
          <Text className="text-2xl font-bold text-gray-900 dark:text-white">Health Records</Text>
          <Text className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            All data stored privately on this device.
          </Text>
        </View>
        <Pressable
          onPress={handleUpload}
          disabled={uploading}
          className="w-11 h-11 rounded-full bg-primary-600 items-center justify-center shadow active:opacity-80 disabled:opacity-50"
        >
          {uploading
            ? <ActivityIndicator size="small" color="white" />
            : <FontAwesome name="plus" size={18} color="white" />}
        </Pressable>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#2563eb" />
        </View>
      ) : (
        <ScrollView
          className="flex-1"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); loadData(); }}
            />
          }
        >
          {/* ── Documents section ── */}
          <Text className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider px-4 pt-4 pb-2">
            Documents ({docs.length})
          </Text>

          {docs.length === 0 ? (
            <View className="mx-4 rounded-xl border border-dashed border-gray-200 dark:border-gray-700 items-center py-10">
              <Text className="text-4xl mb-3">📁</Text>
              <Text className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">No documents yet</Text>
              <Text className="text-xs text-gray-400 dark:text-gray-500">Tap + to upload a PDF</Text>
            </View>
          ) : (
            <View className="mx-4 rounded-xl overflow-hidden border border-gray-100 dark:border-gray-800">
              {docs.map((doc, idx) => (
                <View key={doc.id}>
                  <DocumentRow
                    doc={doc}
                    isProcessing={processingId === doc.id || (doc.ingestionStatus === 'processing' && queueCount > 0)}
                    onProcess={() => handleProcess(doc.id)}
                    onDelete={() => handleDelete(doc.id, doc.filename)}
                    onView={() => handleView(doc)}
                  />
                  {idx < docs.length - 1 && <SectionDivider />}
                </View>
              ))}
            </View>
          )}

          {/* ── Extracted Records section ── */}
          {records.length > 0 && (
            <>
              <Text className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider px-4 pt-6 pb-2">
                Extracted Records ({records.length})
              </Text>
              {groupEntries.map(([groupLabel, groupRecords]) => (
                <View key={groupLabel} className="mb-4">
                  <Text className="text-xs text-gray-400 dark:text-gray-500 px-4 pb-1">
                    {groupLabel} · {groupRecords.length}
                  </Text>
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
            </>
          )}

          <View className="h-8" />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
