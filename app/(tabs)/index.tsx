import { StyleSheet, TouchableOpacity, View, FlatList, Alert } from 'react-native';
import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { getProjects, deleteProject, Project } from '@/utils/storage';

export default function HomeScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const [projects, setProjects] = useState<Project[]>([]);

  useFocusEffect(
    useCallback(() => {
      getProjects().then(setProjects);
    }, [])
  );

  const handleDeleteProject = (id: string) => {
    Alert.alert(
      "Delete Project",
      "Are you sure you want to delete this project?",
      [
        { text: "Cancel", style: "cancel" },
        { 
          text: "Delete", 
          style: "destructive",
          onPress: async () => {
            await deleteProject(id);
            getProjects().then(setProjects);
          }
        }
      ]
    );
  };

  const openProject = (id: string) => {
    router.push({
      pathname: '/editor',
      params: { projectId: id }
    });
  };

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
      <View style={styles.header}>
        <Ionicons name="film-outline" size={48} color={isDark ? Colors.dark.tint : Colors.light.tint} />
        <View>
          <ThemedText type="title" style={styles.title}>Clipzy</ThemedText>
          <ThemedText style={styles.subtitle}>Studio Editor</ThemedText>
        </View>
      </View>

      <View style={styles.content}>
        <View style={styles.sectionHeader}>
          <ThemedText style={styles.sectionTitle}>Recent Projects</ThemedText>
        </View>

        {projects.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="folder-open-outline" size={48} color="#888" />
            <ThemedText style={styles.emptyText}>No recent projects</ThemedText>
            <ThemedText style={styles.emptySubText}>Tap the + button to create one</ThemedText>
          </View>
        ) : (
          <FlatList
            data={projects}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContainer}
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) => (
              <TouchableOpacity 
                style={[styles.projectCard, { backgroundColor: isDark ? '#1F2937' : '#F3F4F6' }]}
                onPress={() => openProject(item.id)}
              >
                <View style={styles.projectInfo}>
                  <ThemedText style={styles.projectName} numberOfLines={1}>{item.name}</ThemedText>
                  <ThemedText style={styles.projectMeta}>
                    {new Date(item.updatedAt).toLocaleDateString()} • {item.clips.length} clip{item.clips.length !== 1 ? 's' : ''}
                  </ThemedText>
                </View>
                <TouchableOpacity style={styles.deleteButton} onPress={() => handleDeleteProject(item.id)}>
                  <Ionicons name="trash-outline" size={20} color="#EF4444" />
                </TouchableOpacity>
              </TouchableOpacity>
            )}
          />
        )}
      </View>

      <TouchableOpacity 
        style={[styles.fab, { backgroundColor: isDark ? Colors.dark.tint : Colors.light.tint }]} 
        onPress={pickVideo}
        activeOpacity={0.8}
      >
        <Ionicons name="add" size={32} color="#FFF" />
      </TouchableOpacity>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 60,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    marginBottom: 24,
    gap: 16,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
  },
  subtitle: {
    fontSize: 14,
    opacity: 0.7,
  },
  content: {
    flex: 1,
    width: '100%',
  },
  sectionHeader: {
    paddingHorizontal: 24,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  listContainer: {
    paddingHorizontal: 24,
    paddingBottom: 100,
    gap: 12,
  },
  projectCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderRadius: 16,
  },
  projectInfo: {
    flex: 1,
  },
  projectName: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  projectMeta: {
    fontSize: 12,
    opacity: 0.6,
  },
  deleteButton: {
    padding: 8,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    opacity: 0.5,
    marginTop: -40,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: 'bold',
    marginTop: 16,
  },
  emptySubText: {
    fontSize: 14,
    marginTop: 8,
  },
  fab: {
    position: 'absolute',
    bottom: 32,
    right: 24,
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
});
