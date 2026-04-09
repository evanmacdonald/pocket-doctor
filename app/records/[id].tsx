import { useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import FontAwesome from '@expo/vector-icons/FontAwesome';

import { getFhirResourceById, softDeleteFhirResource } from '~/db/repositories/fhir.repository';
import { logEvent } from '~/db/repositories/audit.repository';
import type { FhirResource } from '~/db/schema';

// ─── Field renderers for each FHIR type ───────────────────────────────────────

function FieldRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <View className="py-3 border-b border-gray-100 dark:border-gray-800">
      <Text className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
        {label}
      </Text>
      <Text className="text-sm text-gray-900 dark:text-white">{value}</Text>
    </View>
  );
}

function parseResourceFields(resource: FhirResource): Array<{ label: string; value?: string }> {
  try {
    const r = JSON.parse(resource.resourceJson);
    const fields: Array<{ label: string; value?: string }> = [];

    const add = (label: string, value?: string | null) => {
      if (value) fields.push({ label, value });
    };

    // Common fields
    add('Date', resource.effectiveDate ?? undefined);

    switch (resource.resourceType) {
      case 'Condition':
        add('Condition', r.code?.text ?? r.code?.coding?.[0]?.display);
        add('Clinical Status', r.clinicalStatus?.coding?.[0]?.code);
        add('Verification Status', r.verificationStatus?.coding?.[0]?.code);
        add('Severity', r.severity?.text ?? r.severity?.coding?.[0]?.display);
        add('Onset', r.onsetDateTime ?? r.onsetString);
        add('Abatement', r.abatementDateTime ?? r.abatementString);
        add('Note', r.note?.[0]?.text);
        break;

      case 'Observation':
        add('Test / Observation', r.code?.text ?? r.code?.coding?.[0]?.display);
        add('Status', r.status);
        if (r.valueQuantity) {
          add('Value', `${r.valueQuantity.value} ${r.valueQuantity.unit ?? ''}`);
        } else {
          add('Value', r.valueString ?? r.valueCodeableConcept?.text);
        }
        add('Reference Range', r.referenceRange?.[0]?.text);
        add('Interpretation', r.interpretation?.[0]?.text ?? r.interpretation?.[0]?.coding?.[0]?.display);
        add('Note', r.note?.[0]?.text);
        break;

      case 'MedicationStatement':
      case 'MedicationRequest':
        add('Medication', r.medicationCodeableConcept?.text ?? r.medicationCodeableConcept?.coding?.[0]?.display);
        add('Status', r.status);
        add('Dosage', r.dosage?.[0]?.text ?? r.dosageInstruction?.[0]?.text);
        add('Route', r.dosage?.[0]?.route?.text ?? r.dosageInstruction?.[0]?.route?.text);
        add('Note', r.note?.[0]?.text);
        break;

      case 'AllergyIntolerance':
        add('Allergen', r.code?.text ?? r.code?.coding?.[0]?.display);
        add('Clinical Status', r.clinicalStatus?.coding?.[0]?.code);
        add('Type', r.type);
        add('Category', Array.isArray(r.category) ? r.category.join(', ') : r.category);
        add('Criticality', r.criticality);
        add('Reaction', r.reaction?.[0]?.description ?? r.reaction?.[0]?.manifestation?.[0]?.text);
        add('Note', r.note?.[0]?.text);
        break;

      case 'Immunization':
        add('Vaccine', r.vaccineCode?.text ?? r.vaccineCode?.coding?.[0]?.display);
        add('Status', r.status);
        add('Occurrence', r.occurrenceDateTime);
        add('Lot Number', r.lotNumber);
        add('Site', r.site?.text);
        add('Route', r.route?.text);
        add('Note', r.note?.[0]?.text);
        break;

      case 'Procedure':
        add('Procedure', r.code?.text ?? r.code?.coding?.[0]?.display);
        add('Status', r.status);
        add('Body Site', r.bodySite?.[0]?.text);
        add('Outcome', r.outcome?.text);
        add('Note', r.note?.[0]?.text);
        break;

      case 'DiagnosticReport':
        add('Report', r.code?.text ?? r.code?.coding?.[0]?.display);
        add('Status', r.status);
        add('Conclusion', r.conclusion);
        add('Note', r.note?.[0]?.text);
        break;

      default:
        // Generic fallback — show code and text if available
        add('Type', resource.resourceType);
        add('Code', r.code?.text);
        add('Note', r.note?.[0]?.text);
    }

    return fields;
  } catch {
    return [{ label: 'Error', value: 'Could not parse this record.' }];
  }
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function RecordDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [record, setRecord] = useState<FhirResource | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    getFhirResourceById(id).then((r) => {
      setRecord(r ?? null);
      setLoading(false);
      logEvent({ eventType: 'record_viewed', resourceType: r?.resourceType, resourceId: id });
    });
  }, [id]);

  const canEdit = record != null;

  const handleEdit = () => {
    if (!id) return;
    router.push(`/records/new?edit=${id}`);
  };

  const handleDelete = () => {
    Alert.alert(
      'Delete Record',
      'Are you sure you want to delete this record? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            if (!id) return;
            await softDeleteFhirResource(id);
            router.back();
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-gray-950">
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  if (!record) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-gray-950 px-8">
        <Text className="text-gray-500 dark:text-gray-400 text-center">Record not found.</Text>
      </View>
    );
  }

  const fields = parseResourceFields(record);
  const title = fields.find((f) => f.label !== 'Date')?.value ?? record.resourceType;

  return (
    <>
      <Stack.Screen
        options={{
          title: record.resourceType,
          headerLeft: () => (
            <Pressable onPress={() => router.back()} className="pl-1 pr-3 active:opacity-60 flex-row items-center gap-1">
              <FontAwesome name="chevron-left" size={14} color="#2563eb" />
              <Text className="text-primary-600 text-base">Records</Text>
            </Pressable>
          ),
          headerRight: () => (
            <View className="flex-row items-center gap-4 pr-1">
              {canEdit && (
                <Pressable onPress={handleEdit} className="active:opacity-60">
                  <FontAwesome name="pencil" size={18} color="#2563eb" />
                </Pressable>
              )}
              <Pressable onPress={handleDelete} className="active:opacity-60">
                <FontAwesome name="trash" size={18} color="#ef4444" />
              </Pressable>
            </View>
          ),
        }}
      />
      <SafeAreaView className="flex-1 bg-gray-50 dark:bg-gray-950" edges={['bottom']}>
        <ScrollView className="flex-1">
          {/* Title card */}
          <View className="mx-4 mt-4 mb-2 px-4 py-4 bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800">
            <Text className="text-lg font-bold text-gray-900 dark:text-white">{title}</Text>
            {record.effectiveDate && (
              <Text className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                {record.effectiveDate.slice(0, 10)}
              </Text>
            )}
          </View>

          {/* Fields */}
          <View className="mx-4 mb-4 px-4 bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800">
            {fields.map(({ label, value }) => (
              <FieldRow key={label} label={label} value={value} />
            ))}
          </View>

          {/* Raw JSON (collapsed, for debugging) */}
          <Pressable
            className="mx-4 mb-8 px-4 py-3 bg-gray-100 dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700"
            onPress={() => Alert.alert('Raw FHIR JSON', JSON.stringify(JSON.parse(record.resourceJson), null, 2).slice(0, 1000))}
          >
            <Text className="text-xs text-gray-500 dark:text-gray-400 font-mono text-center">
              View raw FHIR JSON
            </Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </>
  );
}
