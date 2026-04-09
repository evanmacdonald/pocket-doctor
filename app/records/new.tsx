import { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TextInput, Pressable, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { upsertFhirResource, getFhirResourceById, softDeleteFhirResource } from '~/db/repositories/fhir.repository';
import type { FhirResource } from '~/db/schema';

// ─── Resource type config ─────────────────────────────────────────────────────

type ResourceTypeId =
  | 'Condition'
  | 'MedicationStatement'
  | 'AllergyIntolerance'
  | 'Immunization'
  | 'Observation'
  | 'Procedure'
  | 'DiagnosticReport';

const RESOURCE_TYPES: Array<{ id: ResourceTypeId; label: string; icon: string; color: string }> = [
  { id: 'Condition',           label: 'Condition',    icon: '🫀', color: 'bg-red-50 dark:bg-red-950' },
  { id: 'MedicationStatement', label: 'Medication',   icon: '💊', color: 'bg-purple-50 dark:bg-purple-950' },
  { id: 'AllergyIntolerance',  label: 'Allergy',      icon: '⚠️', color: 'bg-amber-50 dark:bg-amber-950' },
  { id: 'Immunization',        label: 'Immunization', icon: '💉', color: 'bg-green-50 dark:bg-green-950' },
  { id: 'Observation',         label: 'Observation',  icon: '🔬', color: 'bg-blue-50 dark:bg-blue-950' },
  { id: 'Procedure',           label: 'Procedure',    icon: '🏥', color: 'bg-indigo-50 dark:bg-indigo-950' },
  { id: 'DiagnosticReport',    label: 'Report',       icon: '📄', color: 'bg-gray-50 dark:bg-gray-900' },
];

// ─── Form state ───────────────────────────────────────────────────────────────

interface FormState {
  conditionName:    string;
  conditionStatus:  'active' | 'resolved' | 'inactive';
  conditionDate:    string;
  conditionNotes:   string;

  medDrug:          string;
  medDose:          string;
  medFrequency:     string;
  medStartDate:     string;
  medStatus:        'active' | 'stopped';

  allergen:         string;
  allergyReaction:  string;
  allergySeverity:  'mild' | 'moderate' | 'severe';
  allergyDate:      string;

  vaccineName:      string;
  vaccineDate:      string;

  obsTestName:      string;
  obsValue:         string;
  obsUnit:          string;
  obsDate:          string;

  procName:         string;
  procDate:         string;
  procNotes:        string;

  reportTitle:      string;
  reportDate:       string;
  reportConclusion: string;
}

const EMPTY_FORM: FormState = {
  conditionName: '', conditionStatus: 'active', conditionDate: '', conditionNotes: '',
  medDrug: '', medDose: '', medFrequency: '', medStartDate: '', medStatus: 'active',
  allergen: '', allergyReaction: '', allergySeverity: 'mild', allergyDate: '',
  vaccineName: '', vaccineDate: '',
  obsTestName: '', obsValue: '', obsUnit: '', obsDate: '',
  procName: '', procDate: '', procNotes: '',
  reportTitle: '', reportDate: '', reportConclusion: '',
};

// ─── FHIR serialization ───────────────────────────────────────────────────────

function toFhir(type: ResourceTypeId, form: FormState): { json: string; effectiveDate: string | null } {
  const id = 'urn:uuid:1';
  let resource: Record<string, unknown>;
  let effectiveDate: string | null = null;

  switch (type) {
    case 'Condition':
      effectiveDate = form.conditionDate || null;
      resource = {
        resourceType: 'Condition', id,
        code: { text: form.conditionName },
        clinicalStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: form.conditionStatus }] },
        ...(form.conditionDate  && { recordedDate: form.conditionDate }),
        ...(form.conditionNotes && { note: [{ text: form.conditionNotes }] }),
      };
      break;

    case 'MedicationStatement': {
      effectiveDate = form.medStartDate || null;
      const dosageText = [form.medDose, form.medFrequency].filter(Boolean).join(' ');
      resource = {
        resourceType: 'MedicationStatement', id,
        status: form.medStatus,
        medicationCodeableConcept: { text: form.medDrug },
        ...(dosageText          && { dosage: [{ text: dosageText }] }),
        ...(form.medStartDate   && { effectivePeriod: { start: form.medStartDate } }),
      };
      break;
    }

    case 'AllergyIntolerance':
      effectiveDate = form.allergyDate || null;
      resource = {
        resourceType: 'AllergyIntolerance', id,
        clinicalStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical', code: 'active' }] },
        code: { text: form.allergen },
        ...(form.allergyReaction && { reaction: [{ description: form.allergyReaction, severity: form.allergySeverity }] }),
        ...(form.allergyDate     && { recordedDate: form.allergyDate }),
      };
      break;

    case 'Immunization':
      effectiveDate = form.vaccineDate || null;
      resource = {
        resourceType: 'Immunization', id,
        status: 'completed',
        vaccineCode: { text: form.vaccineName },
        ...(form.vaccineDate && { occurrenceDateTime: form.vaccineDate }),
      };
      break;

    case 'Observation': {
      effectiveDate = form.obsDate || null;
      const numVal = parseFloat(form.obsValue);
      resource = {
        resourceType: 'Observation', id,
        status: 'final',
        code: { text: form.obsTestName },
        ...(form.obsValue && {
          valueQuantity: {
            value: isNaN(numVal) ? form.obsValue : numVal,
            ...(form.obsUnit && { unit: form.obsUnit }),
          },
        }),
        ...(form.obsDate && { effectiveDateTime: form.obsDate }),
      };
      break;
    }

    case 'Procedure':
      effectiveDate = form.procDate || null;
      resource = {
        resourceType: 'Procedure', id,
        status: 'completed',
        code: { text: form.procName },
        ...(form.procDate  && { performedDateTime: form.procDate }),
        ...(form.procNotes && { note: [{ text: form.procNotes }] }),
      };
      break;

    case 'DiagnosticReport':
      effectiveDate = form.reportDate || null;
      resource = {
        resourceType: 'DiagnosticReport', id,
        status: 'final',
        code: { text: form.reportTitle },
        ...(form.reportDate       && { effectiveDateTime: form.reportDate }),
        ...(form.reportConclusion && { conclusion: form.reportConclusion }),
      };
      break;
  }

  return { json: JSON.stringify(resource), effectiveDate };
}

function fromFhir(resource: FhirResource): { type: ResourceTypeId; form: FormState } {
  const form = { ...EMPTY_FORM };
  const type = resource.resourceType as ResourceTypeId;
  try {
    const r = JSON.parse(resource.resourceJson);
    switch (type) {
      case 'Condition':
        form.conditionName   = r.code?.text ?? r.code?.coding?.[0]?.display ?? '';
        form.conditionStatus = r.clinicalStatus?.coding?.[0]?.code ?? 'active';
        form.conditionDate   = r.recordedDate ?? resource.effectiveDate ?? '';
        form.conditionNotes  = r.note?.[0]?.text ?? '';
        break;
      case 'MedicationStatement': {
        const dosage = r.dosage?.[0]?.text ?? '';
        const parts  = dosage.split(' ');
        form.medDrug      = r.medicationCodeableConcept?.text ?? r.medicationCodeableConcept?.coding?.[0]?.display ?? '';
        form.medStatus    = r.status ?? 'active';
        form.medDose      = parts[0] ?? '';
        form.medFrequency = parts.slice(1).join(' ');
        form.medStartDate = r.effectivePeriod?.start ?? resource.effectiveDate ?? '';
        break;
      }
      case 'AllergyIntolerance':
        form.allergen        = r.code?.text ?? r.code?.coding?.[0]?.display ?? '';
        form.allergyReaction = r.reaction?.[0]?.description ?? '';
        form.allergySeverity = r.reaction?.[0]?.severity ?? 'mild';
        form.allergyDate     = r.recordedDate ?? resource.effectiveDate ?? '';
        break;
      case 'Immunization':
        form.vaccineName = r.vaccineCode?.text ?? r.vaccineCode?.coding?.[0]?.display ?? '';
        form.vaccineDate = r.occurrenceDateTime ?? resource.effectiveDate ?? '';
        break;
      case 'Observation':
        form.obsTestName = r.code?.text ?? r.code?.coding?.[0]?.display ?? '';
        form.obsValue    = r.valueQuantity?.value?.toString() ?? '';
        form.obsUnit     = r.valueQuantity?.unit ?? '';
        form.obsDate     = r.effectiveDateTime ?? resource.effectiveDate ?? '';
        break;
      case 'Procedure':
        form.procName  = r.code?.text ?? r.code?.coding?.[0]?.display ?? '';
        form.procDate  = r.performedDateTime ?? resource.effectiveDate ?? '';
        form.procNotes = r.note?.[0]?.text ?? '';
        break;
      case 'DiagnosticReport':
        form.reportTitle      = r.code?.text ?? r.code?.coding?.[0]?.display ?? '';
        form.reportDate       = r.effectiveDateTime ?? resource.effectiveDate ?? '';
        form.reportConclusion = r.conclusion ?? '';
        break;
    }
  } catch { /* return defaults */ }
  return { type, form };
}

// ─── Form components ──────────────────────────────────────────────────────────

function Label({ text }: { text: string }) {
  return (
    <Text className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">
      {text}
    </Text>
  );
}

function InputField({
  label, value, onChangeText, placeholder, multiline = false,
}: {
  label: string; value: string; onChangeText: (v: string) => void;
  placeholder?: string; multiline?: boolean;
}) {
  return (
    <View className="mb-4">
      <Label text={label} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#9ca3af"
        multiline={multiline}
        className={`bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2.5 text-gray-900 dark:text-white text-sm ${multiline ? 'min-h-[80px]' : ''}`}
        autoCapitalize="sentences"
        autoCorrect={false}
      />
    </View>
  );
}

function SegmentedPicker<T extends string>({
  label, options, value, onChange,
}: {
  label: string;
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View className="mb-4">
      <Label text={label} />
      <View className="flex-row gap-2">
        {options.map((opt) => {
          const selected = value === opt.value;
          return (
            <Pressable
              key={opt.value}
              onPress={() => onChange(opt.value)}
              className={`flex-1 py-2 rounded-lg items-center border active:opacity-70 ${
                selected
                  ? 'bg-primary-600 border-primary-600'
                  : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700'
              }`}
            >
              <Text className={`text-sm font-medium ${selected ? 'text-white' : 'text-gray-700 dark:text-gray-300'}`}>
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// ─── Type-specific form fields ────────────────────────────────────────────────

function ConditionForm({ form, set }: { form: FormState; set: (p: Partial<FormState>) => void }) {
  return (
    <>
      <InputField label="Condition name *" value={form.conditionName} onChangeText={(v) => set({ conditionName: v })} placeholder="e.g. Type 2 Diabetes" />
      <SegmentedPicker
        label="Status"
        options={[{ value: 'active', label: 'Active' }, { value: 'resolved', label: 'Resolved' }, { value: 'inactive', label: 'Inactive' }]}
        value={form.conditionStatus}
        onChange={(v) => set({ conditionStatus: v })}
      />
      <InputField label="Date (YYYY-MM-DD)" value={form.conditionDate} onChangeText={(v) => set({ conditionDate: v })} placeholder="2024-03-01" />
      <InputField label="Notes" value={form.conditionNotes} onChangeText={(v) => set({ conditionNotes: v })} multiline />
    </>
  );
}

function MedicationForm({ form, set }: { form: FormState; set: (p: Partial<FormState>) => void }) {
  return (
    <>
      <InputField label="Drug name *" value={form.medDrug} onChangeText={(v) => set({ medDrug: v })} placeholder="e.g. Metformin" />
      <InputField label="Dose" value={form.medDose} onChangeText={(v) => set({ medDose: v })} placeholder="e.g. 500mg" />
      <InputField label="Frequency" value={form.medFrequency} onChangeText={(v) => set({ medFrequency: v })} placeholder="e.g. twice daily" />
      <InputField label="Start date (YYYY-MM-DD)" value={form.medStartDate} onChangeText={(v) => set({ medStartDate: v })} placeholder="2024-01-15" />
      <SegmentedPicker
        label="Status"
        options={[{ value: 'active', label: 'Active' }, { value: 'stopped', label: 'Stopped' }]}
        value={form.medStatus}
        onChange={(v) => set({ medStatus: v })}
      />
    </>
  );
}

function AllergyForm({ form, set }: { form: FormState; set: (p: Partial<FormState>) => void }) {
  return (
    <>
      <InputField label="Allergen *" value={form.allergen} onChangeText={(v) => set({ allergen: v })} placeholder="e.g. Penicillin" />
      <InputField label="Reaction" value={form.allergyReaction} onChangeText={(v) => set({ allergyReaction: v })} placeholder="e.g. Hives, swelling" />
      <SegmentedPicker
        label="Severity"
        options={[{ value: 'mild', label: 'Mild' }, { value: 'moderate', label: 'Moderate' }, { value: 'severe', label: 'Severe' }]}
        value={form.allergySeverity}
        onChange={(v) => set({ allergySeverity: v })}
      />
      <InputField label="Date (YYYY-MM-DD)" value={form.allergyDate} onChangeText={(v) => set({ allergyDate: v })} placeholder="2020-06-01" />
    </>
  );
}

function ImmunizationForm({ form, set }: { form: FormState; set: (p: Partial<FormState>) => void }) {
  return (
    <>
      <InputField label="Vaccine name *" value={form.vaccineName} onChangeText={(v) => set({ vaccineName: v })} placeholder="e.g. Influenza vaccine" />
      <InputField label="Date (YYYY-MM-DD)" value={form.vaccineDate} onChangeText={(v) => set({ vaccineDate: v })} placeholder="2024-10-01" />
    </>
  );
}

function ObservationForm({ form, set }: { form: FormState; set: (p: Partial<FormState>) => void }) {
  return (
    <>
      <InputField label="Test / lab name *" value={form.obsTestName} onChangeText={(v) => set({ obsTestName: v })} placeholder="e.g. HbA1c" />
      <View className="flex-row gap-3">
        <View className="flex-1">
          <InputField label="Value" value={form.obsValue} onChangeText={(v) => set({ obsValue: v })} placeholder="6.8" />
        </View>
        <View className="flex-1">
          <InputField label="Unit" value={form.obsUnit} onChangeText={(v) => set({ obsUnit: v })} placeholder="%" />
        </View>
      </View>
      <InputField label="Date (YYYY-MM-DD)" value={form.obsDate} onChangeText={(v) => set({ obsDate: v })} placeholder="2024-02-20" />
    </>
  );
}

function ProcedureForm({ form, set }: { form: FormState; set: (p: Partial<FormState>) => void }) {
  return (
    <>
      <InputField label="Procedure name *" value={form.procName} onChangeText={(v) => set({ procName: v })} placeholder="e.g. Appendectomy" />
      <InputField label="Date (YYYY-MM-DD)" value={form.procDate} onChangeText={(v) => set({ procDate: v })} placeholder="2019-07-14" />
      <InputField label="Notes" value={form.procNotes} onChangeText={(v) => set({ procNotes: v })} multiline />
    </>
  );
}

function DiagnosticReportForm({ form, set }: { form: FormState; set: (p: Partial<FormState>) => void }) {
  return (
    <>
      <InputField label="Report title *" value={form.reportTitle} onChangeText={(v) => set({ reportTitle: v })} placeholder="e.g. Complete Blood Count" />
      <InputField label="Date (YYYY-MM-DD)" value={form.reportDate} onChangeText={(v) => set({ reportDate: v })} placeholder="2024-03-10" />
      <InputField label="Conclusion / summary" value={form.reportConclusion} onChangeText={(v) => set({ reportConclusion: v })} multiline />
    </>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function NewRecordScreen() {
  const { edit } = useLocalSearchParams<{ edit?: string }>();
  const isEditing = !!edit;

  const [step, setStep]               = useState<'type-select' | 'form'>(isEditing ? 'form' : 'type-select');
  const [selectedType, setSelectedType] = useState<ResourceTypeId | null>(null);
  const [form, setForm]               = useState<FormState>(EMPTY_FORM);
  const [editRecord, setEditRecord]   = useState<FhirResource | null>(null);
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [loadingEdit, setLoadingEdit] = useState(isEditing);

  useEffect(() => {
    if (!edit) return;
    getFhirResourceById(edit).then((r) => {
      if (!r) { setLoadingEdit(false); return; }
      const { type, form: preloaded } = fromFhir(r);
      setEditRecord(r);
      setSelectedType(type);
      setForm(preloaded);
      setLoadingEdit(false);
    }).catch(() => setLoadingEdit(false));
  }, [edit]);

  const patch = (partial: Partial<FormState>) => setForm((prev) => ({ ...prev, ...partial }));

  const validate = (): string | null => {
    switch (selectedType) {
      case 'Condition':           return form.conditionName.trim()   ? null : 'Condition name is required.';
      case 'MedicationStatement': return form.medDrug.trim()         ? null : 'Drug name is required.';
      case 'AllergyIntolerance':  return form.allergen.trim()        ? null : 'Allergen is required.';
      case 'Immunization':        return form.vaccineName.trim()     ? null : 'Vaccine name is required.';
      case 'Observation':         return form.obsTestName.trim()     ? null : 'Test name is required.';
      case 'Procedure':           return form.procName.trim()        ? null : 'Procedure name is required.';
      case 'DiagnosticReport':    return form.reportTitle.trim()     ? null : 'Report title is required.';
      default:                    return 'No record type selected.';
    }
  };

  const handleSave = async () => {
    if (!selectedType) return;
    const validationError = validate();
    if (validationError) { setError(validationError); return; }

    setSaving(true);
    setError(null);
    try {
      const { json, effectiveDate } = toFhir(selectedType, form);

      // For edits: soft-delete the old record, then create a fresh one
      if (isEditing && editRecord) {
        await softDeleteFhirResource(editRecord.id);
      }

      const saved = await upsertFhirResource({
        resourceType:     selectedType,
        resourceJson:     json,
        sourceDocumentId: null,
        effectiveDate,
      });

      // Navigate to the new/updated record
      router.replace(`/records/${saved.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save. Please try again.');
      setSaving(false);
    }
  };

  const title = isEditing ? 'Edit Record' : 'New Record';

  if (loadingEdit) {
    return (
      <>
        <Stack.Screen options={{ title }} />
        <View className="flex-1 items-center justify-center bg-gray-50 dark:bg-gray-950">
          <ActivityIndicator size="large" color="#2563eb" />
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          title,
          headerLeft: () => (
            <Pressable onPress={() => router.back()} className="pl-1 pr-3 active:opacity-60 flex-row items-center gap-1">
              <FontAwesome name="chevron-left" size={14} color="#2563eb" />
              <Text className="text-primary-600 text-base">Back</Text>
            </Pressable>
          ),
        }}
      />
      <SafeAreaView className="flex-1 bg-gray-50 dark:bg-gray-950" edges={['bottom']}>

        {/* ── Step 1: type selection ── */}
        {step === 'type-select' && (
          <ScrollView className="flex-1 px-4 pt-4">
            <Text className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              What type of record would you like to add?
            </Text>
            <View className="flex-row flex-wrap gap-3">
              {RESOURCE_TYPES.map((rt) => (
                <Pressable
                  key={rt.id}
                  onPress={() => { setSelectedType(rt.id); setStep('form'); }}
                  className="w-[47%] bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl p-4 active:opacity-70"
                >
                  <View className={`w-10 h-10 rounded-xl items-center justify-center mb-2 ${rt.color}`}>
                    <Text className="text-xl">{rt.icon}</Text>
                  </View>
                  <Text className="text-sm font-semibold text-gray-900 dark:text-white">{rt.label}</Text>
                </Pressable>
              ))}
            </View>
            <View className="h-8" />
          </ScrollView>
        )}

        {/* ── Step 2: form ── */}
        {step === 'form' && selectedType && (
          <ScrollView className="flex-1 px-4 pt-4" keyboardShouldPersistTaps="handled">
            {!isEditing && (
              <Pressable onPress={() => setStep('type-select')} className="flex-row items-center gap-1 mb-4">
                <FontAwesome name="chevron-left" size={12} color="#2563eb" />
                <Text className="text-primary-600 text-sm">Change type</Text>
              </Pressable>
            )}

            <View className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 px-4 pt-4 pb-2 mb-4">
              {selectedType === 'Condition'           && <ConditionForm     form={form} set={patch} />}
              {selectedType === 'MedicationStatement' && <MedicationForm    form={form} set={patch} />}
              {selectedType === 'AllergyIntolerance'  && <AllergyForm       form={form} set={patch} />}
              {selectedType === 'Immunization'        && <ImmunizationForm  form={form} set={patch} />}
              {selectedType === 'Observation'         && <ObservationForm   form={form} set={patch} />}
              {selectedType === 'Procedure'           && <ProcedureForm     form={form} set={patch} />}
              {selectedType === 'DiagnosticReport'    && <DiagnosticReportForm form={form} set={patch} />}
            </View>

            {error && (
              <Text className="text-sm text-red-600 dark:text-red-400 mb-3">{error}</Text>
            )}

            <Pressable
              onPress={handleSave}
              disabled={saving}
              className="bg-primary-600 rounded-xl py-3.5 items-center active:opacity-80 disabled:opacity-40 mb-8"
            >
              {saving
                ? <ActivityIndicator size="small" color="white" />
                : <Text className="text-white font-semibold text-base">{isEditing ? 'Save Changes' : 'Save Record'}</Text>
              }
            </Pressable>
          </ScrollView>
        )}
      </SafeAreaView>
    </>
  );
}
