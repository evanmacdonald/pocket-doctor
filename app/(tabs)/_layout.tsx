import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Tabs } from 'expo-router';
import { useColorScheme } from '@/components/useColorScheme';

function TabIcon(props: {
  name: React.ComponentProps<typeof FontAwesome>['name'];
  color: string;
}) {
  return <FontAwesome size={22} style={{ marginBottom: -2 }} {...props} />;
}

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const tint = colorScheme === 'dark' ? '#60a5fa' : '#2563eb';

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: tint,
        headerStyle: {
          backgroundColor: colorScheme === 'dark' ? '#030712' : '#ffffff',
        },
        headerTintColor: colorScheme === 'dark' ? '#f9fafb' : '#111827',
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Records',
          tabBarIcon: ({ color }) => <TabIcon name="folder-open" color={color} />,
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: 'Chat',
          tabBarIcon: ({ color }) => <TabIcon name="comment" color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          headerShown: false,
          tabBarIcon: ({ color }) => <TabIcon name="gear" color={color} />,
        }}
      />
    </Tabs>
  );
}
