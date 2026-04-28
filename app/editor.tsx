import { useState, useRef, useEffect } from 'react';
import { StyleSheet, View, TouchableOpacity, ScrollView, Text, ActivityIndicator, Alert, Modal } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useVideoPlayer, VideoView } from 'expo-video';
import Slider from '@react-native-community/slider';
import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import { processVideo, getVideoMetadata } from '@/utils/ffmpeg';
import { RangeSlider } from '@/components/ui/RangeSlider';

type Tool = 'trim' | 'speed' | 'color' | null;

export default function EditorScreen() {
  const { uri } = useLocalSearchParams<{ uri: string }>();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  
  const player = useVideoPlayer(uri, player => {
    player.loop = true;
    player.play();
  });

  const [isPlaying, setIsPlaying] = useState(true);
  const [activeTool, setActiveTool] = useState<Tool>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);

  // Edit states
  const [speed, setSpeed] = useState<number>(1.0);
  const [brightness, setBrightness] = useState<number>(0);
  const [contrast, setContrast] = useState<number>(1.0);
  const [trimStart, setTrimStart] = useState<number>(0);
  const [trimEnd, setTrimEnd] = useState<number>(0);
  const [videoDuration, setVideoDuration] = useState<number>(0);

  useEffect(() => {
    if (uri) {
      getVideoMetadata(uri).then(metadata => {
        if (metadata && metadata.duration) {
          setVideoDuration(metadata.duration);
          setTrimEnd(metadata.duration);
        }
      });
    }
  }, [uri]);

  // Loop playback within trimmed range
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isPlaying && activeTool === 'trim' && videoDuration > 0) {
      interval = setInterval(() => {
        if (player) {
          if (player.currentTime >= trimEnd) {
            player.currentTime = trimStart;
          } else if (player.currentTime < trimStart) {
            player.currentTime = trimStart;
          }
        }
      }, 100);
    }
    return () => clearInterval(interval);
  }, [isPlaying, activeTool, trimStart, trimEnd, player, videoDuration]);
  
  // Export states
  const [exportResolution, setExportResolution] = useState<string>('Original'); // 'Original', '1280x720', '1920x1080', '3840x2160'
  const [exportFps, setExportFps] = useState<string>('Original'); // 'Original', '30', '60'

  const togglePlayPause = () => {
    if (isPlaying) {
      player.pause();
    } else {
      player.play();
    }
    setIsPlaying(!isPlaying);
  };

  // When speed changes, apply to player if possible (expo-video supports playbackRate)
  useEffect(() => {
    if (player) {
      player.playbackRate = speed;
    }
  }, [speed, player]);

  const activeColor = isDark ? Colors.dark.tint : Colors.light.tint;

  const handleExport = () => {
    setShowExportModal(true);
  };

  const executeExport = async () => {
    if (!uri) return;

    setShowExportModal(false);

    // Request permissions
    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'We need permission to save videos to your gallery.');
      return;
    }

    try {
      setIsExporting(true);
      
      const outputUri = `${FileSystem.cacheDirectory}output_${Date.now()}.mp4`;
      
      const options: any = {
        speed: speed,
        color: { brightness, contrast, saturation: 1 }
      };

      if (trimStart > 0 || trimEnd < videoDuration) {
        options.trim = { start: trimStart, end: trimEnd };
      }

      if (exportResolution !== 'Original') {
        options.resolution = exportResolution;
      }
      if (exportFps !== 'Original') {
        options.fps = parseInt(exportFps, 10);
      }

      const success = await processVideo(uri, outputUri, options);

      if (success) {
        await MediaLibrary.saveToLibraryAsync(outputUri);
        Alert.alert('Success', 'Video exported to gallery successfully!');
      } else {
        Alert.alert('Error', 'Failed to process video.');
      }
    } catch (error) {
      console.error(error);
      Alert.alert('Error', 'An unexpected error occurred during export.');
    } finally {
      setIsExporting(false);
    }
  };

  const renderToolOptions = () => {
    if (activeTool === 'speed') {
      return (
        <View style={styles.toolOptionsContainer}>
          <ThemedText style={styles.toolTitle}>Speed</ThemedText>
          <View style={styles.speedOptions}>
            {[0.5, 1.0, 2.0].map((s) => (
              <TouchableOpacity 
                key={s} 
                style={[styles.speedButton, speed === s && { backgroundColor: activeColor }]}
                onPress={() => setSpeed(s)}
              >
                <Text style={[styles.speedButtonText, speed === s && { color: '#FFF' }]}>{s}x</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      );
    }

    if (activeTool === 'color') {
      return (
        <View style={styles.toolOptionsContainer}>
          <ThemedText style={styles.toolTitle}>Color Adjustments</ThemedText>
          
          <ThemedText style={styles.sliderLabel}>Brightness: {brightness.toFixed(2)}</ThemedText>
          <Slider
            style={{width: '100%', height: 40}}
            minimumValue={-1}
            maximumValue={1}
            value={brightness}
            onValueChange={setBrightness}
            minimumTrackTintColor={activeColor}
            maximumTrackTintColor={isDark ? '#333' : '#ddd'}
            thumbTintColor={activeColor}
          />

          <ThemedText style={styles.sliderLabel}>Contrast: {contrast.toFixed(2)}</ThemedText>
          <Slider
            style={{width: '100%', height: 40}}
            minimumValue={0}
            maximumValue={2}
            value={contrast}
            onValueChange={setContrast}
            minimumTrackTintColor={activeColor}
            maximumTrackTintColor={isDark ? '#333' : '#ddd'}
            thumbTintColor={activeColor}
          />
        </View>
      );
    }

    if (activeTool === 'trim') {
      const formatTime = (seconds: number) => {
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s < 10 ? '0' : ''}${s}`;
      };

      return (
        <View style={styles.toolOptionsContainer}>
          <ThemedText style={styles.toolTitle}>Trim Video</ThemedText>
          {videoDuration > 0 ? (
            <View style={{ width: '100%', paddingHorizontal: 10 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}>
                <ThemedText style={styles.sliderLabel}>Start: {formatTime(trimStart)}</ThemedText>
                <ThemedText style={styles.sliderLabel}>End: {formatTime(trimEnd)}</ThemedText>
              </View>
              <RangeSlider 
                min={0} 
                max={videoDuration} 
                initialLow={trimStart} 
                initialHigh={trimEnd} 
                onValueChanged={(low, high) => {
                  setTrimStart(low);
                  setTrimEnd(high);
                  if (player) {
                    player.currentTime = low;
                  }
                }}
                onValuesChanging={(low, high) => {
                  setTrimStart(low);
                  setTrimEnd(high);
                }}
                activeColor={activeColor}
              />
            </View>
          ) : (
            <ActivityIndicator color={activeColor} />
          )}
        </View>
      );
    }

    return (
      <View style={styles.controlsContainer}>
        <TouchableOpacity onPress={togglePlayPause} style={styles.playButton}>
          <Ionicons name={isPlaying ? "pause" : "play"} size={32} color="#FFF" />
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconButton} disabled={isExporting}>
          <Ionicons name="chevron-back" size={28} color={isDark ? Colors.dark.text : Colors.light.text} />
        </TouchableOpacity>
        <ThemedText style={styles.headerTitle}>Editor</ThemedText>
        <TouchableOpacity style={styles.iconButton} onPress={handleExport} disabled={isExporting}>
          {isExporting ? (
            <ActivityIndicator color={activeColor} />
          ) : (
            <Ionicons name="download-outline" size={28} color={activeColor} />
          )}
        </TouchableOpacity>
      </View>

      <View style={styles.videoContainer}>
        {uri ? (
          <VideoView
            style={styles.video}
            player={player}
            allowsFullscreen={false}
            allowsPictureInPicture={false}
            nativeControls={false}
          />
        ) : (
          <View style={styles.placeholderVideo}>
            <Ionicons name="alert-circle-outline" size={48} color="#999" />
            <ThemedText>No video selected</ThemedText>
          </View>
        )}
      </View>

      <View style={styles.toolArea}>
        {renderToolOptions()}
      </View>

      <View style={styles.toolbarContainer}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.toolbar}>
          <ToolbarButton 
            icon="cut-outline" 
            label="Trim" 
            isActive={activeTool === 'trim'} 
            onPress={() => setActiveTool(activeTool === 'trim' ? null : 'trim')} 
            activeColor={activeColor} 
            isDark={isDark} 
          />
          <ToolbarButton 
            icon="speedometer-outline" 
            label="Speed" 
            isActive={activeTool === 'speed'} 
            onPress={() => setActiveTool(activeTool === 'speed' ? null : 'speed')} 
            activeColor={activeColor} 
            isDark={isDark} 
          />
          <ToolbarButton 
            icon="color-palette-outline" 
            label="Color" 
            isActive={activeTool === 'color'} 
            onPress={() => setActiveTool(activeTool === 'color' ? null : 'color')} 
            activeColor={activeColor} 
            isDark={isDark} 
          />
        </ScrollView>
      </View>

      {/* Export Modal */}
      <Modal visible={showExportModal} transparent={true} animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: isDark ? '#1F2937' : '#FFFFFF' }]}>
            <ThemedText style={styles.modalTitle}>Export Settings</ThemedText>
            
            <ThemedText style={styles.modalSubtitle}>Resolution</ThemedText>
            <View style={styles.optionsRow}>
              {['Original', '1280x720', '1920x1080', '3840x2160'].map(res => (
                <TouchableOpacity 
                  key={res} 
                  style={[styles.optionButton, exportResolution === res && { backgroundColor: activeColor }]} 
                  onPress={() => setExportResolution(res)}>
                  <Text style={[styles.optionText, exportResolution === res && { color: '#FFF' }]}>
                    {res === 'Original' ? res : res === '3840x2160' ? '4K' : res.split('x')[1] + 'p'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <ThemedText style={styles.modalSubtitle}>Framerate</ThemedText>
            <View style={styles.optionsRow}>
              {['Original', '30', '60'].map(fps => (
                <TouchableOpacity 
                  key={fps} 
                  style={[styles.optionButton, exportFps === fps && { backgroundColor: activeColor }]} 
                  onPress={() => setExportFps(fps)}>
                  <Text style={[styles.optionText, exportFps === fps && { color: '#FFF' }]}>
                    {fps === 'Original' ? fps : `${fps} fps`}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancelButton} onPress={() => setShowExportModal(false)}>
                <Text style={{ color: isDark ? '#FFF' : '#000' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalExportButton, { backgroundColor: activeColor }]} onPress={executeExport}>
                <Text style={{ color: '#FFF', fontWeight: 'bold' }}>Export Video</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ThemedView>
  );
}

function ToolbarButton({ icon, label, isActive, onPress, activeColor, isDark }: { icon: any, label: string, isActive: boolean, onPress: () => void, activeColor: string, isDark: boolean }) {
  return (
    <TouchableOpacity style={styles.toolbarButton} onPress={onPress}>
      <View style={[
        styles.iconWrapper, 
        { backgroundColor: isDark ? '#181A1F' : '#F3F4F6' },
        isActive && { backgroundColor: isDark ? '#2D3748' : '#DBEAFE', borderColor: activeColor, borderWidth: 1 }
      ]}>
        <Ionicons name={icon} size={24} color={isActive ? activeColor : (isDark ? '#FFF' : '#000')} />
      </View>
      <ThemedText style={[styles.toolbarLabel, isActive && { color: activeColor }]}>{label}</ThemedText>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 50,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '600',
  },
  iconButton: {
    padding: 8,
  },
  videoContainer: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  video: {
    width: '100%',
    height: '100%',
  },
  placeholderVideo: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  toolArea: {
    height: 140,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  controlsContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  playButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#3B82F6',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#3B82F6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  toolOptionsContainer: {
    flex: 1,
    justifyContent: 'center',
    paddingVertical: 10,
  },
  toolTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 12,
    textAlign: 'center',
  },
  speedOptions: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 20,
  },
  speedButton: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 20,
    backgroundColor: '#333',
  },
  speedButtonText: {
    color: '#AAA',
    fontSize: 16,
    fontWeight: 'bold',
  },
  sliderLabel: {
    fontSize: 12,
    marginTop: 8,
  },
  toolbarContainer: {
    paddingVertical: 16,
    paddingBottom: 32,
    borderTopWidth: 1,
    borderTopColor: '#272A30',
  },
  toolbar: {
    paddingHorizontal: 16,
    gap: 20,
  },
  toolbarButton: {
    alignItems: 'center',
    gap: 8,
  },
  iconWrapper: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolbarLabel: {
    fontSize: 12,
    fontWeight: '500',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    width: '100%',
    borderRadius: 16,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
  },
  modalSubtitle: {
    fontSize: 16,
    fontWeight: '600',
    marginTop: 10,
    marginBottom: 8,
  },
  optionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  optionButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: '#4B5563',
  },
  optionText: {
    color: '#D1D5DB',
    fontSize: 14,
    fontWeight: '500',
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 20,
  },
  modalCancelButton: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    justifyContent: 'center',
  },
  modalExportButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    justifyContent: 'center',
  },
});

