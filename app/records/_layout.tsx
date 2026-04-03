import { Stack } from 'expo-router';

export default function RecordsLayout() {
  return (
    <Stack screenOptions={{ headerShown: true, headerBackTitle: 'Records' }} />
  );
}
