import { useState, useRef, useEffect, useMemo } from 'react';
import { StyleSheet, View, TouchableOpacity, ScrollView, Text, ActivityIndicator, Alert, Modal } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useVideoPlayer, VideoView } from 'expo-video';
import Slider from '@react-native-community/slider';
import { Paths } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import DraggableFlatList, { ScaleDecorator } from 'react-native-draggable-flatlist';
import { processVideo, getVideoMetadata, generateThumbnails, ClipInput } from '@/utils/ffmpeg';
import { RangeSlider } from '@/components/ui/RangeSlider';
import { TransformCanvas, TransformState } from '@/components/ui/TransformCanvas';
import { saveProject, getProject, Project } from '@/utils/storage';

type Tool = 'trim' | 'speed' | 'color' | 'format' | 'music' | null;

interface ClipData {
  uri: string;
  trimStart: number;
  trimEnd: number;
  duration: number;
  width: number;
  height: number;
  thumbnails: string[];
  hasAudio: boolean;
}

export default function EditorScreen() {
  const { projectId, uris: urisParam } = useLocalSearchParams<{ projectId?: string, uris?: string }>();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const insets = useSafeAreaInsets();

  const [currentProjectId, setCurrentProjectId] = useState<string>(projectId || `proj_${Date.now()}`);
  const [projectName, setProjectName] = useState<string>('My Project');

  const [clipsData, setClipsData] = useState<ClipData[]>([]);
  const [activeClipIndex, setActiveClipIndex] = useState(0);
  const [isProjectLoading, setIsProjectLoading] = useState(!!projectId);

  const activeClip = clipsData[activeClipIndex];
  const uri = activeClip?.uri ?? null;

  const player = useVideoPlayer(uri, p => {
    p.loop = true;
    p.play();
  });

  const [isPlaying, setIsPlaying] = useState(true);
  const [activeTool, setActiveTool] = useState<Tool>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);

  // Global edit states (applied to all clips on export)
  const [speed, setSpeed] = useState<number>(1.0);
  const [brightness, setBrightness] = useState<number>(0);
  const [contrast, setContrast] = useState<number>(1.0);
  const [saturation, setSaturation] = useState<number>(1.0);

  // Music state
  const [musicUri, setMusicUri] = useState<string | null>(null);
  const [musicName, setMusicName] = useState<string | null>(null);

  // Transform states
  const [aspectRatio, setAspectRatio] = useState<string>('Original');
  const [transform, setTransform] = useState<TransformState>({ scale: 1, translateX: 0, translateY: 0, rotation: 0 });
  const [resetTrigger, setResetTrigger] = useState<number>(0);

  // Load project on mount if projectId is present, otherwise initialize from urisParam
  useEffect(() => {
    if (projectId) {
      getProject(projectId).then(proj => {
        if (proj) {
          setProjectName(proj.name);
          setClipsData(proj.clips);
          setSpeed(proj.settings.speed);
          setBrightness(proj.settings.brightness);
          setContrast(proj.settings.contrast);
          setSaturation(proj.settings.saturation);
          setAspectRatio(proj.settings.aspectRatio);
          setMusicUri(proj.settings.musicUri || null);
          setMusicName(proj.settings.musicName || null);
        }
        setIsProjectLoading(false);
      });
    } else {
      let initialUris: string[] = [];
      if (urisParam) {
        try { initialUris = JSON.parse(urisParam) as string[]; } catch (e) {}
      }
      setClipsData(initialUris.map(u => ({ uri: u, trimStart: 0, trimEnd: 0, duration: 0, width: 0, height: 0, thumbnails: [], hasAudio: true })));
      setIsProjectLoading(false);
    }
  }, [projectId, urisParam]);

  // Auto-save project when relevant states change
  useEffect(() => {
    if (isProjectLoading || clipsData.length === 0) return;
    
    const timeout = setTimeout(() => {
      const project: Project = {
        id: currentProjectId,
        name: projectName,
        createdAt: parseInt(currentProjectId.replace('proj_', ''), 10) || Date.now(),
        updatedAt: Date.now(),
        clips: clipsData,
        settings: {
          speed, brightness, contrast, saturation, aspectRatio, musicUri, musicName
        }
      };
      saveProject(project);
    }, 1000); // Debounce saves by 1s

    return () => clearTimeout(timeout);
  }, [clipsData, speed, brightness, contrast, saturation, aspectRatio, musicUri, musicName, currentProjectId, projectName, isProjectLoading]);

  // Preload metadata for all clips that don't have it yet
  useEffect(() => {
    clipsData.forEach((clip, index) => {
      if (clip.duration === 0) {
        getVideoMetadata(clip.uri).then(metadata => {
          if (metadata) {
            setClipsData(prev => {
              const next = [...prev];
              if (next[index] && next[index].duration === 0) {
                next[index] = { 
                  ...next[index], 
                  duration: metadata.duration, 
                  trimEnd: metadata.duration, 
                  width: metadata.width, 
                  height: metadata.height, 
                  hasAudio: metadata.hasAudio 
                };
              }
              return next;
            });
          }
        });
      }
    });
  }, [clipsData]);

  // Load thumbnails ONLY for the active clip
  useEffect(() => {
    if (!activeClip || activeClip.duration === 0 || activeClip.thumbnails.length > 0) return;
    generateThumbnails(activeClip.uri, activeClip.duration, 8).then(thumbs => {
      setClipsData(prev => prev.map((c, i) =>
        i === activeClipIndex ? { ...c, thumbnails: thumbs } : c
      ));
    });
  }, [activeClipIndex, activeClip?.duration, activeClip?.thumbnails.length, activeClip?.uri]);

  // Loop playback within trimmed range of active clip
  useEffect(() => {
    if (!activeClip) return;
    let interval: NodeJS.Timeout;
    if (isPlaying && activeTool === 'trim' && activeClip.duration > 0) {
      interval = setInterval(() => {
        if (player) {
          if (player.currentTime >= activeClip.trimEnd) {
            player.currentTime = activeClip.trimStart;
          } else if (player.currentTime < activeClip.trimStart) {
            player.currentTime = activeClip.trimStart;
          }
        }
      }, 100);
    }
    return () => clearInterval(interval);
  }, [isPlaying, activeTool, activeClip?.trimStart, activeClip?.trimEnd, player, activeClip?.duration]);
  
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
  
  const handleAddClip = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'],
      allowsEditing: false,
      allowsMultipleSelection: true,
      quality: 1,
    });
    if (!result.canceled && result.assets) {
      const newClips: ClipData[] = result.assets.map(a => ({
        uri: a.uri, trimStart: 0, trimEnd: 0, duration: 0, width: 0, height: 0, thumbnails: [], hasAudio: true
      }));
      setClipsData(prev => [...prev, ...newClips]);
    }
  };

  const executeExport = async () => {
    if (clipsData.length === 0) return;
    setShowExportModal(false);
    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'We need permission to save videos to your gallery.');
      return;
    }
    try {
      setIsExporting(true);
      const outputUri = `${Paths.cache.uri}output_${Date.now()}.mp4`;

      // Build per-clip inputs with individual trims
      const clipInputs: ClipInput[] = clipsData.map(c => ({
        uri: c.uri,
        hasAudio: c.hasAudio,
        ...(c.duration > 0 && (c.trimStart > 0 || c.trimEnd < c.duration)
          ? { trim: { start: c.trimStart, end: c.trimEnd } }
          : {}),
      }));

      const options: any = {
        speed,
        color: { brightness, contrast, saturation },
        transform: {
          scale: transform.scale,
          translateX: transform.translateX,
          translateY: transform.translateY,
          rotation: transform.rotation,
          targetRatio: aspectRatio,
        },
      };
      if (musicUri) options.musicUri = musicUri;
      if (exportResolution !== 'Original') options.resolution = exportResolution;
      if (exportFps !== 'Original') options.fps = parseInt(exportFps, 10);

      const success = await processVideo(clipInputs, outputUri, options);
      if (success) {
        await MediaLibrary.saveToLibraryAsync(outputUri);
        Alert.alert('✅ Exported', 'Video saved to your gallery!');
      } else {
        Alert.alert('Export Failed', 'FFmpeg could not process the video. Check that all clips have video streams.');
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

          <ThemedText style={styles.sliderLabel}>Saturation: {saturation.toFixed(2)}</ThemedText>
          <Slider
            style={{width: '100%', height: 40}}
            minimumValue={0}
            maximumValue={3}
            value={saturation}
            onValueChange={setSaturation}
            minimumTrackTintColor={activeColor}
            maximumTrackTintColor={isDark ? '#333' : '#ddd'}
            thumbTintColor={activeColor}
          />
        </View>
      );
    }

    if (activeTool === 'trim') {
      const fmt = (s: number) => `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
      return (
        <View style={styles.toolOptionsContainer}>
          <ThemedText style={styles.toolTitle}>Trim — Clip {activeClipIndex + 1}</ThemedText>
          {activeClip && activeClip.duration > 0 ? (
            <View style={{ width: '100%', paddingHorizontal: 10 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                <ThemedText style={styles.sliderLabel}>Start: {fmt(activeClip.trimStart)}</ThemedText>
                <ThemedText style={styles.sliderLabel}>End: {fmt(activeClip.trimEnd)}</ThemedText>
              </View>
              {/* key forces remount when switching clips so refs reinitialize */}
              <RangeSlider
                key={`rs-${activeClipIndex}`}
                min={0}
                max={activeClip.duration}
                initialLow={activeClip.trimStart}
                initialHigh={activeClip.trimEnd}
                onValueChanged={(low, high) => {
                  setClipsData(prev => prev.map((c, i) =>
                    i === activeClipIndex ? { ...c, trimStart: low, trimEnd: high } : c
                  ));
                  if (player) player.currentTime = low;
                }}
                onValuesChanging={(low, high) => {
                  setClipsData(prev => prev.map((c, i) =>
                    i === activeClipIndex ? { ...c, trimStart: low, trimEnd: high } : c
                  ));
                }}
                activeColor={activeColor}
                thumbnails={activeClip.thumbnails}
              />
            </View>
          ) : (
            <ActivityIndicator color={activeColor} />
          )}
        </View>
      );
    }

    if (activeTool === 'format') {
      return (
        <View style={styles.toolOptionsContainer}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <ThemedText style={styles.toolTitle}>Aspect Ratio</ThemedText>
            <TouchableOpacity onPress={() => setResetTrigger(prev => prev + 1)} style={{ padding: 4, backgroundColor: '#333', borderRadius: 4, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Ionicons name="refresh-outline" size={16} color="#FFF" />
              <Text style={{ color: '#FFF', fontSize: 12 }}>Reset</Text>
            </TouchableOpacity>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
            {['Original', '16:9', '9:16', '1:1'].map((fmt) => (
              <TouchableOpacity 
                key={fmt} 
                style={[{ paddingVertical: 8, paddingHorizontal: 16, borderRadius: 20, backgroundColor: '#333' }, aspectRatio === fmt && { backgroundColor: activeColor }]}
                onPress={() => setAspectRatio(fmt)}
              >
                <Text style={[{ color: '#AAA', fontWeight: 'bold' }, aspectRatio === fmt && { color: '#FFF' }]}>{fmt}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      );
    }

    if (activeTool === 'music') {
      const pickAudio = async () => {
        try {
          const result = await DocumentPicker.getDocumentAsync({
            type: 'audio/*',
            copyToCacheDirectory: true,
          });
          if (!result.canceled && result.assets && result.assets.length > 0) {
            setMusicUri(result.assets[0].uri);
            setMusicName(result.assets[0].name);
          }
        } catch (err) {
          console.log('Error picking audio', err);
        }
      };

      return (
        <View style={styles.toolOptionsContainer}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <ThemedText style={styles.toolTitle}>Background Music</ThemedText>
            {musicUri && (
              <TouchableOpacity onPress={() => { setMusicUri(null); setMusicName(null); }} style={{ padding: 4, backgroundColor: '#333', borderRadius: 4, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Ionicons name="trash-outline" size={16} color="#ef4444" />
                <Text style={{ color: '#ef4444', fontSize: 12 }}>Remove</Text>
              </TouchableOpacity>
            )}
          </View>
          <View style={{ alignItems: 'center' }}>
            <TouchableOpacity 
              style={[styles.button, { backgroundColor: isDark ? Colors.dark.tint : Colors.light.tint, width: 'auto', paddingHorizontal: 20, paddingVertical: 12, flexDirection: 'row', gap: 8, alignItems: 'center', borderRadius: 16 }]} 
              onPress={pickAudio}
            >
              <Ionicons name="musical-notes-outline" size={20} color="#FFF" />
              <ThemedText style={{ color: '#FFF', fontSize: 16, fontWeight: 'bold' }}>{musicUri ? 'Change Audio' : 'Select Audio File'}</ThemedText>
            </TouchableOpacity>
            {musicName && (
              <ThemedText style={{ marginTop: 12, fontSize: 12, color: '#AAA' }} numberOfLines={1}>Selected: {musicName}</ThemedText>
            )}
          </View>
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

  if (isProjectLoading) {
    return (
      <ThemedView style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={activeColor} />
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconButton} disabled={isExporting}>
          <Ionicons name="chevron-back" size={28} color={isDark ? Colors.dark.text : Colors.light.text} />
        </TouchableOpacity>
        <ThemedText style={styles.headerTitle} numberOfLines={1}>{projectName}</ThemedText>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity style={styles.iconButton} onPress={handleAddClip} disabled={isExporting}>
            <Ionicons name="add-circle-outline" size={28} color={isDark ? Colors.dark.text : Colors.light.text} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconButton} onPress={handleExport} disabled={isExporting}>
            {isExporting ? (
              <ActivityIndicator color={activeColor} />
            ) : (
              <Ionicons name="download-outline" size={28} color={activeColor} />
            )}
          </TouchableOpacity>
        </View>
      </View>

      {clipsData.length > 1 && (
        <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
          <DraggableFlatList
            horizontal
            data={clipsData}
            onDragEnd={({ data }) => {
              const currentUri = clipsData[activeClipIndex]?.uri;
              setClipsData(data);
              const newIndex = data.findIndex(c => c.uri === currentUri);
              if (newIndex !== -1) setActiveClipIndex(newIndex);
            }}
            keyExtractor={(item, index) => `${item.uri}_${index}`}
            contentContainerStyle={{ gap: 8 }}
            renderItem={({ item, drag, isActive, getIndex }) => {
              const i = getIndex() ?? 0;
              return (
                <ScaleDecorator>
                  <TouchableOpacity
                    onLongPress={drag}
                    onPress={() => setActiveClipIndex(i)}
                    style={{
                      paddingVertical: 6, paddingHorizontal: 14,
                      backgroundColor: isActive ? '#555' : (i === activeClipIndex ? activeColor : '#2D3748'),
                      borderRadius: 12,
                      elevation: isActive ? 5 : 0,
                      borderWidth: i === activeClipIndex ? 0 : 1,
                      borderColor: '#4B5563',
                    }}
                  >
                    <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>Clip {i + 1}</Text>
                  </TouchableOpacity>
                </ScaleDecorator>
              );
            }}
          />
        </View>
      )}

      <View style={styles.videoContainer}>
        {uri ? (
          <TransformCanvas 
            player={player}
            aspectRatio={aspectRatio}
            videoWidth={activeClip?.width ?? 0}
            videoHeight={activeClip?.height ?? 0}
            onTransformChange={setTransform}
            resetTrigger={resetTrigger}
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

      <View style={[styles.toolbarContainer, { paddingBottom: Math.max(insets.bottom, 16) }]}>
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
            icon="crop-outline" 
            label="Format" 
            isActive={activeTool === 'format'} 
            onPress={() => setActiveTool(activeTool === 'format' ? null : 'format')} 
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
          <ToolbarButton 
            icon="musical-notes-outline" 
            label="Music" 
            isActive={activeTool === 'music'} 
            onPress={() => setActiveTool(activeTool === 'music' ? null : 'music')} 
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
    minHeight: 140,
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
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
    paddingTop: 12,
    paddingBottom: 16,
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
  button: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
});

