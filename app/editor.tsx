import { useState, useRef, useEffect, useCallback } from 'react';
import {
  StyleSheet, View, TouchableOpacity, ScrollView, Text,
  ActivityIndicator, Alert, Modal, Image
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useVideoPlayer } from 'expo-video';
import Slider from '@react-native-community/slider';
import { Paths } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import DraggableFlatList, { ScaleDecorator } from 'react-native-draggable-flatlist';
import { processVideo, getVideoMetadata, generateThumbnails, ClipInput, FFmpegResult } from '@/utils/ffmpeg';
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

interface EditorSnapshot {
  clipsData: ClipData[];
  activeClipIndex: number;
  speed: number;
  brightness: number;
  contrast: number;
  saturation: number;
  aspectRatio: string;
}

const TIMELINE_HEIGHT = 80;
const THUMB_CARD_MIN_W = 72;
const THUMB_CARD_MAX_W = 260;
const PIXELS_PER_SECOND = 18;
const MAX_UNDO_HISTORY = 20;

export default function EditorScreen() {
  const { projectId, uris: urisParam } = useLocalSearchParams<{ projectId?: string; uris?: string }>();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const insets = useSafeAreaInsets();

  const [currentProjectId] = useState<string>(projectId || `proj_${Date.now()}`);
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
  const [exportProgress, setExportProgress] = useState<number>(0);
  const [showExportModal, setShowExportModal] = useState(false);

  const [speed, setSpeed] = useState<number>(1.0);
  const [brightness, setBrightness] = useState<number>(0);
  const [contrast, setContrast] = useState<number>(1.0);
  const [saturation, setSaturation] = useState<number>(1.0);

  const [musicUri, setMusicUri] = useState<string | null>(null);
  const [musicName, setMusicName] = useState<string | null>(null);
  const [videoVolume, setVideoVolume] = useState<number>(1.0);
  const [musicVolume, setMusicVolume] = useState<number>(0.5);

  const [aspectRatio, setAspectRatio] = useState<string>('Original');
  const [transform, setTransform] = useState<TransformState>({ scale: 1, translateX: 0, translateY: 0, rotation: 0 });
  const [resetTrigger, setResetTrigger] = useState<number>(0);

  const [exportResolution, setExportResolution] = useState<string>('Original');
  const [exportFps, setExportFps] = useState<string>('Original');

  // Undo/Redo history
  const [undoStack, setUndoStack] = useState<EditorSnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<EditorSnapshot[]>([]);

  const trimLabelStartRef = useRef<Text | null>(null);
  const trimLabelEndRef = useRef<Text | null>(null);
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  // Snapshot for undo
  const takeSnapshot = useCallback(() => {
    const snapshot: EditorSnapshot = {
      clipsData: JSON.parse(JSON.stringify(clipsData)),
      activeClipIndex,
      speed, brightness, contrast, saturation, aspectRatio,
    };
    setUndoStack(prev => {
      const next = [...prev, snapshot];
      return next.length > MAX_UNDO_HISTORY ? next.slice(-MAX_UNDO_HISTORY) : next;
    });
    setRedoStack([]);
  }, [clipsData, activeClipIndex, speed, brightness, contrast, saturation, aspectRatio]);

  const undo = useCallback(() => {
    if (undoStack.length === 0) return;
    const current: EditorSnapshot = {
      clipsData: JSON.parse(JSON.stringify(clipsData)),
      activeClipIndex,
      speed, brightness, contrast, saturation, aspectRatio,
    };
    setRedoStack(prev => [...prev, current]);
    const prev = undoStack[undoStack.length - 1];
    setUndoStack(s => s.slice(0, -1));
    setClipsData(prev.clipsData);
    setActiveClipIndex(prev.activeClipIndex);
    setSpeed(prev.speed);
    setBrightness(prev.brightness);
    setContrast(prev.contrast);
    setSaturation(prev.saturation);
    setAspectRatio(prev.aspectRatio);
  }, [undoStack, clipsData, activeClipIndex, speed, brightness, contrast, saturation, aspectRatio]);

  const redo = useCallback(() => {
    if (redoStack.length === 0) return;
    const current: EditorSnapshot = {
      clipsData: JSON.parse(JSON.stringify(clipsData)),
      activeClipIndex,
      speed, brightness, contrast, saturation, aspectRatio,
    };
    setUndoStack(prev => [...prev, current]);
    const next = redoStack[redoStack.length - 1];
    setRedoStack(s => s.slice(0, -1));
    setClipsData(next.clipsData);
    setActiveClipIndex(next.activeClipIndex);
    setSpeed(next.speed);
    setBrightness(next.brightness);
    setContrast(next.contrast);
    setSaturation(next.saturation);
    setAspectRatio(next.aspectRatio);
  }, [redoStack, clipsData, activeClipIndex, speed, brightness, contrast, saturation, aspectRatio]);

  // Load project
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
          setVideoVolume(proj.settings.videoVolume ?? 1.0);
          setMusicVolume(proj.settings.musicVolume ?? 0.5);
        }
        setIsProjectLoading(false);
      });
    } else {
      let initialUris: string[] = [];
      if (urisParam) {
        try { initialUris = JSON.parse(urisParam) as string[]; } catch { }
      }
      setClipsData(initialUris.map(u => ({
        uri: u, trimStart: 0, trimEnd: 0, duration: 0,
        width: 0, height: 0, thumbnails: [], hasAudio: true,
      })));
      setIsProjectLoading(false);
    }
  }, [projectId, urisParam]);

  // Auto-save (debounced 1s)
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
          speed, brightness, contrast, saturation, aspectRatio,
          musicUri, musicName, videoVolume, musicVolume,
        },
      };
      saveProject(project);
    }, 1000);
    return () => clearTimeout(timeout);
  }, [clipsData, speed, brightness, contrast, saturation, aspectRatio,
    musicUri, musicName, videoVolume, musicVolume, currentProjectId, projectName, isProjectLoading]);

  // Load metadata for new clips
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
                  hasAudio: metadata.hasAudio,
                };
              }
              return next;
            });
          }
        });
      }
    });
  }, [clipsData]);

  // Load thumbnails for active clip only
  useEffect(() => {
    if (!activeClip || activeClip.duration === 0 || activeClip.thumbnails.length > 0) return;
    generateThumbnails(activeClip.uri, activeClip.duration, 10).then(thumbs => {
      setClipsData(prev => prev.map((c, i) =>
        i === activeClipIndex ? { ...c, thumbnails: thumbs } : c
      ));
    });
  }, [activeClipIndex, activeClip?.duration, activeClip?.thumbnails.length, activeClip?.uri]);

  // Playback loop respecting trim boundaries
  useEffect(() => {
    if (!activeClip || !player || activeClip.duration === 0) return;
    if (player.currentTime < activeClip.trimStart || player.currentTime > activeClip.trimEnd) {
      player.currentTime = activeClip.trimStart;
    }
    const interval = setInterval(() => {
      if (player && isPlaying) {
        if (player.currentTime >= activeClip.trimEnd) {
          player.currentTime = activeClip.trimStart;
          player.play();
        } else if (player.currentTime < activeClip.trimStart) {
          player.currentTime = activeClip.trimStart;
          player.play();
        }
      }
    }, 100);
    return () => clearInterval(interval);
  }, [activeClip?.uri, activeClip?.trimStart, activeClip?.trimEnd, isPlaying, player]);

  // Sync speed to player
  useEffect(() => {
    if (player) player.playbackRate = speed;
  }, [speed, player]);

  const activeColor = isDark ? Colors.dark.tint : Colors.light.tint;

  const togglePlayPause = useCallback(() => {
    if (isPlaying) { player.pause(); } else { player.play(); }
    setIsPlaying(p => !p);
  }, [isPlaying, player]);

  const handleDeleteClip = useCallback((index: number) => {
    if (clipsData.length <= 1) {
      Alert.alert('Cannot delete', 'You must have at least one video clip in your project.');
      return;
    }
    takeSnapshot();
    Alert.alert('Delete Clip', `Delete Clip ${index + 1}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: () => setClipsData(prev => {
          const updated = prev.filter((_, i) => i !== index);
          if (activeClipIndex >= updated.length) setActiveClipIndex(updated.length - 1);
          return updated;
        }),
      },
    ]);
  }, [clipsData.length, activeClipIndex, takeSnapshot]);

  const handleSplitClip = useCallback(() => {
    if (!activeClip || activeClip.duration === 0) return;
    const currentTime = player.currentTime;
    const { trimStart, trimEnd } = activeClip;
    if (currentTime <= trimStart + 0.5 || currentTime >= trimEnd - 0.5) {
      Alert.alert('Cannot Split', 'The split point must be at least 0.5s away from the start/end.');
      return;
    }
    takeSnapshot();
    const clipA: ClipData = { ...activeClip, trimEnd: currentTime };
    const clipB: ClipData = { ...activeClip, trimStart: currentTime, thumbnails: [] };
    setClipsData(prev => {
      const next = [...prev];
      next.splice(activeClipIndex, 1, clipA, clipB);
      return next;
    });
    setTimeout(() => setActiveClipIndex(activeClipIndex + 1), 100);
  }, [activeClip, player, activeClipIndex, takeSnapshot]);

  const handleAddClip = useCallback(async () => {
    takeSnapshot();
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'],
      allowsEditing: false,
      allowsMultipleSelection: true,
      quality: 1,
    });
    if (!result.canceled && result.assets) {
      const newClips: ClipData[] = result.assets.map(a => ({
        uri: a.uri, trimStart: 0, trimEnd: 0, duration: 0,
        width: 0, height: 0, thumbnails: [], hasAudio: true,
      }));
      setClipsData(prev => [...prev, ...newClips]);
    }
  }, [takeSnapshot]);

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
      setExportProgress(0);
      const outputUri = `${Paths.cache.uri}output_${Date.now()}.mp4`;
      const clipInputs: ClipInput[] = clipsData.map(c => ({
        uri: c.uri,
        hasAudio: c.hasAudio,
        duration: c.duration,
        ...(c.duration > 0 && (c.trimStart > 0 || c.trimEnd < c.duration)
          ? { trim: { start: c.trimStart, end: c.trimEnd } }
          : {}),
      }));

      const totalDuration = clipsData.reduce((sum, c) => sum + Math.max(0, c.trimEnd - c.trimStart), 0);

      const options: any = {
        speed,
        color: { brightness, contrast, saturation },
        transform: { ...transform, targetRatio: aspectRatio },
        videoVolume,
        musicVolume,
      };
      if (musicUri) options.musicUri = musicUri;
      if (exportResolution !== 'Original') options.resolution = exportResolution;
      if (exportFps !== 'Original') options.fps = parseInt(exportFps, 10);

      const result: FFmpegResult = await processVideo(clipInputs, outputUri, options, (progress) => {
        setExportProgress(progress.percent);
      });

      if (result.success) {
        await MediaLibrary.saveToLibraryAsync(outputUri);
        Alert.alert('Exported!', 'Video saved to your gallery!');
      } else {
        Alert.alert('Export Failed', result.error || 'FFmpeg could not process the video.');
      }
    } catch (error) {
      console.error(error);
      Alert.alert('Error', 'An unexpected error occurred during export.');
    } finally {
      setIsExporting(false);
      setExportProgress(0);
    }
  };

  const renderToolOptions = () => {
    if (activeTool === 'speed') {
      return (
        <View style={styles.toolOptionsContainer}>
          <ThemedText style={styles.toolTitle}>Playback Speed</ThemedText>
          <View style={styles.speedOptions}>
            {[0.25, 0.5, 1.0, 1.5, 2.0, 3.0].map(s => (
              <TouchableOpacity
                key={s}
                style={[styles.speedButton, speed === s && { backgroundColor: activeColor }]}
                onPress={() => { takeSnapshot(); setSpeed(s); }}
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
        <ScrollView style={styles.toolOptionsContainer} showsVerticalScrollIndicator={false}>
          <ThemedText style={styles.toolTitle}>Color Adjustments</ThemedText>

          <ThemedText style={styles.sliderLabel}>Brightness: {brightness.toFixed(2)}</ThemedText>
          <Slider
            style={{ width: '100%', height: 36 }}
            minimumValue={-1} maximumValue={1} value={brightness}
            onValueChange={setBrightness}
            onSlidingComplete={() => takeSnapshot()}
            minimumTrackTintColor={activeColor}
            maximumTrackTintColor={isDark ? '#333' : '#ddd'}
            thumbTintColor={activeColor}
          />

          <ThemedText style={styles.sliderLabel}>Contrast: {contrast.toFixed(2)}</ThemedText>
          <Slider
            style={{ width: '100%', height: 36 }}
            minimumValue={0} maximumValue={2} value={contrast}
            onValueChange={setContrast}
            onSlidingComplete={() => takeSnapshot()}
            minimumTrackTintColor={activeColor}
            maximumTrackTintColor={isDark ? '#333' : '#ddd'}
            thumbTintColor={activeColor}
          />

          <ThemedText style={styles.sliderLabel}>Saturation: {saturation.toFixed(2)}</ThemedText>
          <Slider
            style={{ width: '100%', height: 36 }}
            minimumValue={0} maximumValue={3} value={saturation}
            onValueChange={setSaturation}
            onSlidingComplete={() => takeSnapshot()}
            minimumTrackTintColor={activeColor}
            maximumTrackTintColor={isDark ? '#333' : '#ddd'}
            thumbTintColor={activeColor}
          />
        </ScrollView>
      );
    }

    if (activeTool === 'trim') {
      return (
        <View style={styles.toolOptionsContainer}>
          <ThemedText style={styles.toolTitle}>Trim — Clip {activeClipIndex + 1}</ThemedText>
          {activeClip && activeClip.duration > 0 ? (
            <View style={{ width: '100%', paddingHorizontal: 10 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                <Text
                  ref={trimLabelStartRef}
                  style={[styles.sliderLabel, { color: isDark ? '#AAA' : '#555' }]}
                >
                  Start: {fmt(activeClip.trimStart)}
                </Text>
                <Text
                  ref={trimLabelEndRef}
                  style={[styles.sliderLabel, { color: isDark ? '#AAA' : '#555' }]}
                >
                  End: {fmt(activeClip.trimEnd)}
                </Text>
              </View>
              <RangeSlider
                key={`rs-${activeClipIndex}-${activeClip.uri}`}
                min={0}
                max={activeClip.duration}
                initialLow={activeClip.trimStart}
                initialHigh={activeClip.trimEnd}
                onValuesChanging={(low, high) => {
                  if (player) player.currentTime = low;
                  trimLabelStartRef.current?.setNativeProps({ text: `Start: ${fmt(low)}` });
                  trimLabelEndRef.current?.setNativeProps({ text: `End: ${fmt(high)}` });
                }}
                onValueChanged={(low, high) => {
                  takeSnapshot();
                  setClipsData(prev => prev.map((c, i) =>
                    i === activeClipIndex ? { ...c, trimStart: low, trimEnd: high } : c
                  ));
                  if (player) player.currentTime = low;
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
            <TouchableOpacity
              onPress={() => setResetTrigger(p => p + 1)}
              style={{ padding: 6, backgroundColor: '#333', borderRadius: 8, flexDirection: 'row', alignItems: 'center', gap: 4 }}
            >
              <Ionicons name="refresh-outline" size={14} color="#FFF" />
              <Text style={{ color: '#FFF', fontSize: 12 }}>Reset</Text>
            </TouchableOpacity>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
            {['Original', '16:9', '9:16', '1:1'].map(r => (
              <TouchableOpacity
                key={r}
                style={[styles.ratioBtn, aspectRatio === r && { backgroundColor: activeColor }]}
                onPress={() => { takeSnapshot(); setAspectRatio(r); }}
              >
                <Text style={[styles.ratioBtnText, aspectRatio === r && { color: '#FFF' }]}>{r}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      );
    }

    if (activeTool === 'music') {
      const pickAudio = async () => {
        try {
          const result = await DocumentPicker.getDocumentAsync({ type: 'audio/*', copyToCacheDirectory: true });
          if (!result.canceled && result.assets?.length > 0) {
            takeSnapshot();
            setMusicUri(result.assets[0].uri);
            setMusicName(result.assets[0].name);
          }
        } catch (err) { console.log('Error picking audio', err); }
      };

      return (
        <ScrollView style={styles.toolOptionsContainer} showsVerticalScrollIndicator={false}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <ThemedText style={styles.toolTitle}>Background Music</ThemedText>
            {musicUri && (
              <TouchableOpacity
                onPress={() => { takeSnapshot(); setMusicUri(null); setMusicName(null); }}
                style={{ padding: 6, backgroundColor: '#3A1215', borderRadius: 8, flexDirection: 'row', alignItems: 'center', gap: 4 }}
              >
                <Ionicons name="trash-outline" size={14} color="#EF4444" />
                <Text style={{ color: '#EF4444', fontSize: 12 }}>Remove</Text>
              </TouchableOpacity>
            )}
          </View>

          <TouchableOpacity
            style={[styles.musicPickBtn, { backgroundColor: activeColor }]}
            onPress={pickAudio}
          >
            <Ionicons name="musical-notes-outline" size={18} color="#FFF" />
            <Text style={styles.musicPickBtnText}>{musicUri ? 'Change Audio File' : 'Select Audio File'}</Text>
          </TouchableOpacity>

          {musicName && (
            <Text style={styles.musicFileName} numberOfLines={1}>{musicName}</Text>
          )}

          <View style={{ marginTop: 16 }}>
            <Text style={styles.volLabel}>Video Volume: {Math.round(videoVolume * 100)}%</Text>
            <Slider
              style={{ width: '100%', height: 36 }}
              minimumValue={0} maximumValue={1} value={videoVolume}
              onValueChange={setVideoVolume}
              onSlidingComplete={() => takeSnapshot()}
              minimumTrackTintColor={activeColor}
              maximumTrackTintColor={isDark ? '#333' : '#ddd'}
              thumbTintColor={activeColor}
            />
            {musicUri && <>
              <Text style={styles.volLabel}>Music Volume: {Math.round(musicVolume * 100)}%</Text>
              <Slider
                style={{ width: '100%', height: 36 }}
                minimumValue={0} maximumValue={1} value={musicVolume}
                onValueChange={setMusicVolume}
                onSlidingComplete={() => takeSnapshot()}
                minimumTrackTintColor='#A855F7'
                maximumTrackTintColor={isDark ? '#333' : '#ddd'}
                thumbTintColor='#A855F7'
              />
            </>}
          </View>
        </ScrollView>
      );
    }

    return (
      <View style={styles.controlsContainer}>
        <TouchableOpacity onPress={togglePlayPause} style={[styles.playButton, { backgroundColor: activeColor }]}>
          <Ionicons name={isPlaying ? 'pause' : 'play'} size={30} color="#FFF" />
        </TouchableOpacity>
        {activeClip?.hasAudio === false && (
          <Text style={{ color: '#F59E0B', fontSize: 11, marginTop: 6 }}>No audio track</Text>
        )}
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

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconButton} disabled={isExporting}>
          <Ionicons name="chevron-back" size={26} color={isDark ? Colors.dark.text : Colors.light.text} />
        </TouchableOpacity>
        <ThemedText style={styles.headerTitle} numberOfLines={1}>{projectName}</ThemedText>
        <View style={{ flexDirection: 'row', gap: 4 }}>
          <TouchableOpacity
            style={[styles.iconButton, undoStack.length === 0 && { opacity: 0.3 }]}
            onPress={undo}
            disabled={undoStack.length === 0 || isExporting}
          >
            <Ionicons name="arrow-undo-outline" size={22} color={isDark ? Colors.dark.text : Colors.light.text} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.iconButton, redoStack.length === 0 && { opacity: 0.3 }]}
            onPress={redo}
            disabled={redoStack.length === 0 || isExporting}
          >
            <Ionicons name="arrow-redo-outline" size={22} color={isDark ? Colors.dark.text : Colors.light.text} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconButton} onPress={handleAddClip} disabled={isExporting}>
            <Ionicons name="add-circle-outline" size={26} color={isDark ? Colors.dark.text : Colors.light.text} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconButton} onPress={() => setShowExportModal(true)} disabled={isExporting}>
            {isExporting
              ? <ActivityIndicator color={activeColor} />
              : <Ionicons name="download-outline" size={26} color={activeColor} />
            }
          </TouchableOpacity>
        </View>
      </View>

      {/* Timeline */}
      <View style={styles.timelineContainer}>
        <View style={styles.timelineHeader}>
          <Text style={[styles.timelineTitle, { color: isDark ? '#94A3B8' : '#64748B' }]}>TIMELINE</Text>
          <Text style={[styles.timelineSubtitle, { color: isDark ? '#475569' : '#94A3B8' }]}>Hold to reorder - Tap to select</Text>
        </View>

        <DraggableFlatList
          horizontal
          data={clipsData}
          onDragEnd={({ data }) => {
            const currentUri = clipsData[activeClipIndex]?.uri;
            takeSnapshot();
            setClipsData(data);
            const newIndex = data.findIndex(c => c.uri === currentUri);
            if (newIndex !== -1) setActiveClipIndex(newIndex);
          }}
          keyExtractor={(item, index) => `${item.uri}_${index}`}
          contentContainerStyle={styles.timelineList}
          showsHorizontalScrollIndicator={false}
          renderItem={({ item, drag, isActive, getIndex }) => {
            const i = getIndex() ?? 0;
            const isSelected = i === activeClipIndex;
            const activeDuration = item.duration > 0 ? (item.trimEnd - item.trimStart) : 0;
            const cardW = item.duration > 0
              ? Math.max(THUMB_CARD_MIN_W, Math.min(THUMB_CARD_MAX_W, Math.round(activeDuration * PIXELS_PER_SECOND)))
              : THUMB_CARD_MIN_W;

            return (
              <ScaleDecorator>
                <TouchableOpacity
                  onLongPress={drag}
                  onPress={() => {
                    setActiveClipIndex(i);
                    if (item.trimStart !== undefined && player) {
                      player.currentTime = item.trimStart;
                    }
                  }}
                  style={[
                    styles.timelineCard,
                    { width: cardW },
                    isSelected && { borderColor: activeColor, borderWidth: 2.5 },
                    isActive && { opacity: 0.75, transform: [{ scale: 1.04 }] },
                  ]}
                  activeOpacity={0.85}
                >
                  {item.thumbnails.length > 0 ? (
                    <View style={[StyleSheet.absoluteFillObject, { flexDirection: 'row' }]}>
                      {item.thumbnails.slice(0, Math.ceil(cardW / 40)).map((t, ti) => (
                        <Image
                          key={ti}
                          source={{ uri: t }}
                          style={{ flex: 1, height: '100%' }}
                          resizeMode="cover"
                        />
                      ))}
                    </View>
                  ) : (
                    <View style={[StyleSheet.absoluteFillObject, styles.cardPlaceholder]}>
                      {item.duration === 0
                        ? <ActivityIndicator size="small" color="#4B5563" />
                        : <Ionicons name="film-outline" size={18} color="#4B5563" />
                      }
                    </View>
                  )}

                  <View style={[StyleSheet.absoluteFillObject, styles.cardOverlay]}>
                    <View style={styles.cardHeaderRow}>
                      <View style={[styles.cardIndexBadge, isSelected && { backgroundColor: activeColor }]}>
                        <Text style={styles.cardIndexText}>{i + 1}</Text>
                      </View>
                      <TouchableOpacity
                        onPress={() => handleDeleteClip(i)}
                        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                        style={styles.cardDeleteBtn}
                      >
                        <Ionicons name="close-circle" size={16} color="#EF4444" />
                      </TouchableOpacity>
                    </View>

                    <View>
                      <Text style={styles.cardDurationText}>
                        {activeDuration > 0 ? `${activeDuration.toFixed(1)}s` : '...'}
                      </Text>
                      {item.hasAudio === false && (
                        <Text style={styles.cardNoAudioText}>silent</Text>
                      )}
                    </View>
                  </View>

                  {isSelected && (
                    <View style={[StyleSheet.absoluteFillObject, {
                      borderRadius: 10,
                      borderWidth: 2.5,
                      borderColor: activeColor,
                    }]} pointerEvents="none" />
                  )}
                </TouchableOpacity>
              </ScaleDecorator>
            );
          }}
          ListFooterComponent={
            <TouchableOpacity style={styles.timelineAddCard} onPress={handleAddClip}>
              <Ionicons name="add" size={20} color={activeColor} />
              <Text style={{ color: activeColor, fontSize: 9, fontWeight: '700', marginTop: 2 }}>ADD</Text>
            </TouchableOpacity>
          }
          ListFooterComponentStyle={{ justifyContent: 'center', paddingLeft: 6 }}
        />
      </View>

      {/* Video Preview */}
      <View style={styles.videoContainer}>
        {uri ? (
          <TransformCanvas
            player={player}
            aspectRatio={aspectRatio}
            videoWidth={activeClip?.width ?? 0}
            videoHeight={activeClip?.height ?? 0}
            onTransformChange={setTransform}
            resetTrigger={resetTrigger}
            brightness={brightness}
          />
        ) : (
          <View style={styles.placeholderVideo}>
            <Ionicons name="film-outline" size={48} color="#999" />
            <ThemedText>No video selected</ThemedText>
          </View>
        )}
      </View>

      {/* Tool Panel */}
      <View style={styles.toolArea}>
        {renderToolOptions()}
      </View>

      {/* Toolbar */}
      <View style={[styles.toolbarContainer, { paddingBottom: Math.max(insets.bottom, 14) }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.toolbar}>
          <ToolbarButton icon="cut-outline" label="Trim"
            isActive={activeTool === 'trim'} activeColor={activeColor} isDark={isDark}
            onPress={() => setActiveTool(activeTool === 'trim' ? null : 'trim')} />
          <ToolbarButton icon="scissors-outline" label="Split"
            isActive={false} activeColor={activeColor} isDark={isDark}
            onPress={handleSplitClip} />
          <ToolbarButton icon="crop-outline" label="Format"
            isActive={activeTool === 'format'} activeColor={activeColor} isDark={isDark}
            onPress={() => setActiveTool(activeTool === 'format' ? null : 'format')} />
          <ToolbarButton icon="speedometer-outline" label="Speed"
            isActive={activeTool === 'speed'} activeColor={activeColor} isDark={isDark}
            onPress={() => setActiveTool(activeTool === 'speed' ? null : 'speed')} />
          <ToolbarButton icon="color-palette-outline" label="Color"
            isActive={activeTool === 'color'} activeColor={activeColor} isDark={isDark}
            onPress={() => setActiveTool(activeTool === 'color' ? null : 'color')} />
          <ToolbarButton
            icon="musical-notes-outline" label="Music"
            isActive={activeTool === 'music'} activeColor={activeColor} isDark={isDark}
            badge={!!musicUri}
            onPress={() => setActiveTool(activeTool === 'music' ? null : 'music')} />
        </ScrollView>
      </View>

      {/* Export Modal */}
      <Modal visible={showExportModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: isDark ? '#1A1F2E' : '#FFFFFF' }]}>
            <ThemedText style={styles.modalTitle}>Export Settings</ThemedText>

            <ThemedText style={styles.modalSubtitle}>Resolution</ThemedText>
            <View style={styles.optionsRow}>
              {['Original', '1280x720', '1920x1080', '3840x2160'].map(res => (
                <TouchableOpacity
                  key={res}
                  style={[styles.optionButton, exportResolution === res && { backgroundColor: activeColor }]}
                  onPress={() => setExportResolution(res)}
                >
                  <Text style={[styles.optionText, exportResolution === res && { color: '#FFF' }]}>
                    {res === 'Original' ? 'Auto' : res === '3840x2160' ? '4K' : res.split('x')[1] + 'p'}
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
                  onPress={() => setExportFps(fps)}
                >
                  <Text style={[styles.optionText, exportFps === fps && { color: '#FFF' }]}>
                    {fps === 'Original' ? 'Auto' : `${fps} fps`}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={{ backgroundColor: isDark ? '#0F172A' : '#F1F5F9', borderRadius: 10, padding: 12, marginVertical: 8 }}>
              <Text style={{ color: isDark ? '#94A3B8' : '#64748B', fontSize: 12 }}>
                {clipsData.length} clip{clipsData.length !== 1 ? 's' : ''} - {
                  clipsData.reduce((sum, c) => sum + Math.max(0, c.trimEnd - c.trimStart), 0).toFixed(1)
                }s total
              </Text>
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancelButton} onPress={() => setShowExportModal(false)}>
                <Text style={{ color: isDark ? '#CBD5E1' : '#374151', fontWeight: '500' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalExportButton, { backgroundColor: activeColor }]}
                onPress={executeExport}
              >
                <Text style={{ color: '#FFF', fontWeight: 'bold', fontSize: 15 }}>Export Video</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Export Progress Modal */}
      <Modal visible={isExporting} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: isDark ? '#1A1F2E' : '#FFFFFF', alignItems: 'center' }]}>
            <ActivityIndicator size="large" color={activeColor} />
            <ThemedText style={[styles.modalTitle, { marginTop: 16 }]}>Exporting Video...</ThemedText>
            <Text style={{ color: isDark ? '#94A3B8' : '#64748B', fontSize: 13, marginTop: 8 }}>
              {exportProgress > 0 ? `${Math.round(exportProgress)}%` : 'Preparing...'}
            </Text>
            <View style={styles.progressBarBg}>
              <View style={[styles.progressBarFill, { width: `${Math.max(1, exportProgress)}%`, backgroundColor: activeColor }]} />
            </View>
          </View>
        </View>
      </Modal>

    </ThemedView>
  );
}

function ToolbarButton({
  icon, label, isActive, onPress, activeColor, isDark, badge = false,
}: {
  icon: any; label: string; isActive: boolean; onPress: () => void;
  activeColor: string; isDark: boolean; badge?: boolean;
}) {
  return (
    <TouchableOpacity style={styles.toolbarButton} onPress={onPress}>
      <View style={[
        styles.iconWrapper,
        { backgroundColor: isDark ? '#181A1F' : '#F3F4F6' },
        isActive && { backgroundColor: isDark ? '#1E293B' : '#DBEAFE', borderColor: activeColor, borderWidth: 1.5 },
      ]}>
        <Ionicons name={icon} size={22} color={isActive ? activeColor : (isDark ? '#CBD5E1' : '#374151')} />
        {badge && (
          <View style={[styles.badgeDot, { backgroundColor: activeColor }]} />
        )}
      </View>
      <ThemedText style={[styles.toolbarLabel, isActive && { color: activeColor }]}>{label}</ThemedText>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingBottom: 10,
  },
  headerTitle: { fontSize: 18, fontWeight: '700', flex: 1, textAlign: 'center' },
  iconButton: { padding: 8 },

  videoContainer: { flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' },
  placeholderVideo: { alignItems: 'center', justifyContent: 'center', gap: 12 },

  timelineContainer: { paddingHorizontal: 12, paddingBottom: 10, paddingTop: 2 },
  timelineHeader: {
    flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between',
    marginBottom: 6, paddingHorizontal: 2,
  },
  timelineTitle: { fontSize: 10, fontWeight: '800', letterSpacing: 1.5 },
  timelineSubtitle: { fontSize: 9 },
  timelineList: { gap: 5, paddingRight: 12, alignItems: 'center', height: TIMELINE_HEIGHT + 4 },

  timelineCard: {
    height: TIMELINE_HEIGHT,
    borderRadius: 10,
    backgroundColor: '#0F172A',
    borderWidth: 1.5,
    borderColor: '#1E293B',
    overflow: 'hidden',
    position: 'relative',
  },
  cardPlaceholder: { justifyContent: 'center', alignItems: 'center', backgroundColor: '#0F172A' },
  cardOverlay: {
    flex: 1,
    backgroundColor: 'rgba(2,6,23,0.52)',
    padding: 5,
    justifyContent: 'space-between',
  },
  cardHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardIndexBadge: {
    width: 17, height: 17, borderRadius: 8.5,
    backgroundColor: '#334155', justifyContent: 'center', alignItems: 'center',
  },
  cardIndexText: { color: '#FFF', fontSize: 9, fontWeight: '800' },
  cardDeleteBtn: { opacity: 0.9 },
  cardDurationText: {
    color: '#FFF', fontSize: 9, fontWeight: '700',
    backgroundColor: 'rgba(0,0,0,0.65)', paddingVertical: 2, paddingHorizontal: 5,
    borderRadius: 4, overflow: 'hidden', alignSelf: 'flex-start',
  },
  cardNoAudioText: {
    color: '#F59E0B', fontSize: 8, fontWeight: '600',
    marginTop: 1, alignSelf: 'flex-start',
  },
  timelineAddCard: {
    width: 56, height: TIMELINE_HEIGHT, borderRadius: 10,
    borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#3B82F6',
    justifyContent: 'center', alignItems: 'center',
    backgroundColor: 'rgba(59,130,246,0.06)',
  },

  toolArea: { height: 148, justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 6 },
  toolOptionsContainer: { flex: 1 },
  toolTitle: { fontSize: 14, fontWeight: '700', marginBottom: 10, textAlign: 'center' },
  sliderLabel: { fontSize: 11, marginTop: 4, color: '#94A3B8' },

  controlsContainer: { alignItems: 'center', justifyContent: 'center' },
  playButton: {
    width: 60, height: 60, borderRadius: 30,
    alignItems: 'center', justifyContent: 'center',
    shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 8, elevation: 6,
  },

  speedOptions: { flexDirection: 'row', justifyContent: 'center', gap: 8, flexWrap: 'wrap' },
  speedButton: {
    paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20, backgroundColor: '#1E293B',
  },
  speedButtonText: { color: '#94A3B8', fontSize: 14, fontWeight: '700' },

  ratioBtn: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 20, backgroundColor: '#1E293B' },
  ratioBtnText: { color: '#94A3B8', fontWeight: '700', fontSize: 13 },

  musicPickBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 10, paddingHorizontal: 18, borderRadius: 14,
  },
  musicPickBtnText: { color: '#FFF', fontSize: 14, fontWeight: '700' },
  musicFileName: { color: '#94A3B8', fontSize: 11, marginTop: 8, textAlign: 'center' },
  volLabel: { fontSize: 11, color: '#94A3B8', marginTop: 8 },

  toolbarContainer: { paddingTop: 10, borderTopWidth: 1, borderTopColor: '#1E293B' },
  toolbar: { paddingHorizontal: 16, gap: 18 },
  toolbarButton: { alignItems: 'center', gap: 5 },
  iconWrapper: {
    width: 50, height: 50, borderRadius: 25,
    alignItems: 'center', justifyContent: 'center', position: 'relative',
  },
  toolbarLabel: { fontSize: 10, fontWeight: '600', color: '#64748B' },
  badgeDot: {
    width: 8, height: 8, borderRadius: 4,
    position: 'absolute', top: 4, right: 4,
    borderWidth: 1.5, borderColor: '#0F172A',
  },

  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, paddingBottom: 36,
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.3, shadowRadius: 20, elevation: 20,
  },
  modalTitle: { fontSize: 20, fontWeight: '800', marginBottom: 18, textAlign: 'center' },
  modalSubtitle: { fontSize: 13, fontWeight: '700', marginTop: 10, marginBottom: 8, opacity: 0.7 },
  optionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 6 },
  optionButton: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 20, backgroundColor: '#1E293B' },
  optionText: { color: '#94A3B8', fontSize: 13, fontWeight: '600' },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 16 },
  modalCancelButton: { paddingVertical: 12, paddingHorizontal: 18, borderRadius: 10, justifyContent: 'center' },
  modalExportButton: { paddingVertical: 12, paddingHorizontal: 24, borderRadius: 10, justifyContent: 'center' },

  progressBarBg: {
    width: '100%', height: 6, borderRadius: 3,
    backgroundColor: '#1E293B', marginTop: 16, overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%', borderRadius: 3,
  },
});
