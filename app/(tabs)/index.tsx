import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function HomeScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  const pickVideo = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'],
      allowsEditing: false, 
      allowsMultipleSelection: true,
      quality: 1,
    });

    if (!result.canceled && result.assets && result.assets.length > 0) {
      const uris = result.assets.map(a => a.uri);
      // Navigate to editor screen with the video uris
      router.push({
        pathname: '/editor',
        params: { uris: JSON.stringify(uris) }
      });
    }
  };

  return (
    <ThemedView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.header}>
          <Ionicons name="film-outline" size={64} color={isDark ? Colors.dark.tint : Colors.light.tint} />
          <ThemedText type="title" style={styles.title}>Studio</ThemedText>
          <ThemedText style={styles.subtitle}>Create your next masterpiece</ThemedText>
        </View>

        <TouchableOpacity 
          style={[styles.button, { backgroundColor: isDark ? Colors.dark.tint : Colors.light.tint }]} 
          onPress={pickVideo}
          activeOpacity={0.8}
        >
          <Ionicons name="add-circle-outline" size={24} color="#FFF" />
          <ThemedText style={styles.buttonText}>New Project</ThemedText>
        </TouchableOpacity>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    alignItems: 'center',
    padding: 24,
    width: '100%',
  },
  header: {
    alignItems: 'center',
    marginBottom: 60,
  },
  title: {
    fontSize: 42,
    fontWeight: 'bold',
    marginTop: 16,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    opacity: 0.7,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 16,
    gap: 12,
    width: '100%',
    justifyContent: 'center',
    shadowColor: '#3B82F6',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  buttonText: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: 'bold',
  },
});
