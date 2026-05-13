import { StyleSheet, View, Switch, Alert, Platform } from 'react-native';
import ParallaxScrollView from '@/components/parallax-scroll-view';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Fonts, Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import Constants from 'expo-constants';
import { Paths, getInfoAsync, readDirectoryAsync, deleteAsync } from 'expo-file-system';
import { Ionicons } from '@expo/vector-icons';
import { TouchableOpacity } from 'react-native';

export default function SettingsScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  const handleClearCache = async () => {
    try {
      const cacheDir = `${Paths.cache.uri}`;
      const dirInfo = await getInfoAsync(cacheDir);
      
      if (dirInfo.exists) {
        Alert.alert(
          "Clear Cache",
          "Are you sure you want to clear temporary files? This won't delete your projects.",
          [
            { text: "Cancel", style: "cancel" },
            { 
              text: "Clear", 
              style: "destructive",
              onPress: async () => {
                const files = await readDirectoryAsync(cacheDir);
                for (const file of files) {
                  await deleteAsync(`${cacheDir}${file}`, { idempotent: true });
                }
                Alert.alert("Success", "Cache cleared successfully.");
              }
            }
          ]
        );
      }
    } catch (error) {
      console.error(error);
      Alert.alert("Error", "Could not clear cache.");
    }
  };

  const appVersion = Constants.expoConfig?.version || '1.0.0';

  return (
    <ParallaxScrollView
      headerBackgroundColor={{ light: '#DBEAFE', dark: '#1E3A8A' }}
      headerImage={
        <IconSymbol
          size={280}
          color={isDark ? "rgba(255,255,255,0.1)" : "rgba(59, 130, 246, 0.2)"}
          name="gearshape.fill"
          style={styles.headerImage}
        />
      }>
      <ThemedView style={styles.titleContainer}>
        <ThemedText
          type="title"
          style={{ fontFamily: Fonts.rounded }}>
          Settings & Info
        </ThemedText>
      </ThemedView>

      <ThemedView style={styles.section}>
        <ThemedText style={styles.sectionTitle}>About</ThemedText>
        <View style={[styles.card, { backgroundColor: isDark ? '#1F2937' : '#F3F4F6' }]}>
          <View style={styles.row}>
            <ThemedText>App Version</ThemedText>
            <ThemedText style={styles.value}>{appVersion}</ThemedText>
          </View>
          <View style={styles.divider} />
          <View style={styles.row}>
            <ThemedText>Developer</ThemedText>
            <ThemedText style={styles.value}>Alejo</ThemedText>
          </View>
        </View>
      </ThemedView>

      <ThemedView style={styles.section}>
        <ThemedText style={styles.sectionTitle}>Storage</ThemedText>
        <View style={[styles.card, { backgroundColor: isDark ? '#1F2937' : '#F3F4F6' }]}>
          <TouchableOpacity style={styles.actionRow} onPress={handleClearCache}>
            <View style={styles.actionIcon}>
              <Ionicons name="trash-outline" size={24} color="#EF4444" />
            </View>
            <ThemedText style={{ flex: 1, color: '#EF4444' }}>Clear Temporary Cache</ThemedText>
            <Ionicons name="chevron-forward" size={20} color="#9CA3AF" />
          </TouchableOpacity>
        </View>
        <ThemedText style={styles.helpText}>
          Clearing cache removes generated thumbnails and temporary video exports.
        </ThemedText>
      </ThemedView>
    </ParallaxScrollView>
  );
}

const styles = StyleSheet.create({
  headerImage: {
    bottom: -60,
    left: -20,
    position: 'absolute',
  },
  titleContainer: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  section: {
    marginTop: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 12,
    paddingLeft: 4,
  },
  card: {
    borderRadius: 16,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(150,150,150,0.2)',
    marginLeft: 16,
  },
  value: {
    opacity: 0.6,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  actionIcon: {
    marginRight: 12,
  },
  helpText: {
    fontSize: 12,
    opacity: 0.6,
    marginTop: 8,
    paddingHorizontal: 4,
  }
});
