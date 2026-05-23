import React, { useEffect } from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import { VideoView } from 'expo-video';
import Animated, { 
  useSharedValue, 
  useAnimatedStyle, 
  withSpring, 
  runOnJS 
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

export interface TransformState {
  scale: number;
  translateX: number;
  translateY: number;
  rotation: number; // in radians
  canvasWidth?: number;
  canvasHeight?: number;
}

interface TransformCanvasProps {
  player: any;
  aspectRatio: string; // 'Original', '16:9', '9:16', '1:1'
  videoWidth: number;
  videoHeight: number;
  onTransformChange: (state: TransformState) => void;
  resetTrigger?: number;
  brightness?: number; // Real-time preview support
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const MAX_CANVAS_HEIGHT = 400; // Fixed maximum height for the preview area

export function TransformCanvas({ 
  player, 
  aspectRatio, 
  videoWidth, 
  videoHeight,
  onTransformChange,
  resetTrigger,
  brightness = 0
}: TransformCanvasProps) {
  
  // Reanimated Shared Values
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);
  
  const rotation = useSharedValue(0);
  const savedRotation = useSharedValue(0);

  const updateParent = () => {
    // Re-calculate canvas dimensions to pass to parent
    let cWidth = SCREEN_WIDTH;
    let cHeight = MAX_CANVAS_HEIGHT;
    if (videoWidth > 0 && videoHeight > 0) {
      const originalRatio = videoWidth / videoHeight;
      let targetRatio = originalRatio;
      if (aspectRatio === '16:9') targetRatio = 16 / 9;
      else if (aspectRatio === '9:16') targetRatio = 9 / 16;
      else if (aspectRatio === '1:1') targetRatio = 1;

      if (SCREEN_WIDTH / targetRatio <= MAX_CANVAS_HEIGHT) {
        cWidth = SCREEN_WIDTH;
        cHeight = SCREEN_WIDTH / targetRatio;
      } else {
        cHeight = MAX_CANVAS_HEIGHT;
        cWidth = MAX_CANVAS_HEIGHT * targetRatio;
      }
    }

    onTransformChange({
      scale: scale.value,
      translateX: translateX.value,
      translateY: translateY.value,
      rotation: rotation.value,
      canvasWidth: cWidth,
      canvasHeight: cHeight,
    });
  };

  // Reset logic
  useEffect(() => {
    if (resetTrigger) {
      scale.value = withSpring(1);
      savedScale.value = 1;
      translateX.value = withSpring(0);
      translateY.value = withSpring(0);
      savedTranslateX.value = 0;
      savedTranslateY.value = 0;
      rotation.value = withSpring(0);
      savedRotation.value = 0;
      updateParent();
    }
  }, [resetTrigger]);

  // Sync transform state to parent on mount or when dimensions change
  useEffect(() => {
    updateParent();
  }, [videoWidth, videoHeight, aspectRatio]);

  // Gestures
  const pinchGesture = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = savedScale.value * e.scale;
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      runOnJS(updateParent)();
    });

  const panGesture = Gesture.Pan()
    .onUpdate((e) => {
      translateX.value = savedTranslateX.value + e.translationX;
      translateY.value = savedTranslateY.value + e.translationY;
    })
    .onEnd(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
      runOnJS(updateParent)();
    });

  const rotationGesture = Gesture.Rotation()
    .onUpdate((e) => {
      rotation.value = savedRotation.value + e.rotation;
    })
    .onEnd(() => {
      savedRotation.value = rotation.value;
      runOnJS(updateParent)();
    });

  // Compose gestures so they can work simultaneously
  const composedGesture = Gesture.Simultaneous(pinchGesture, panGesture, rotationGesture);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
      { rotateZ: `${rotation.value}rad` },
    ],
  }));

  // Calculate canvas dimensions based on aspect ratio
  let canvasWidth = SCREEN_WIDTH;
  let canvasHeight = MAX_CANVAS_HEIGHT;

  if (videoWidth > 0 && videoHeight > 0) {
    const originalRatio = videoWidth / videoHeight;
    let targetRatio = originalRatio;

    if (aspectRatio === '16:9') targetRatio = 16 / 9;
    else if (aspectRatio === '9:16') targetRatio = 9 / 16;
    else if (aspectRatio === '1:1') targetRatio = 1;

    // Fit canvas within the bounds (SCREEN_WIDTH x MAX_CANVAS_HEIGHT)
    if (SCREEN_WIDTH / targetRatio <= MAX_CANVAS_HEIGHT) {
      canvasWidth = SCREEN_WIDTH;
      canvasHeight = SCREEN_WIDTH / targetRatio;
    } else {
      canvasHeight = MAX_CANVAS_HEIGHT;
      canvasWidth = MAX_CANVAS_HEIGHT * targetRatio;
    }
  }

  return (
    <View style={styles.container}>
      <View 
        style={[
          styles.canvasBounds, 
          { width: canvasWidth, height: canvasHeight }
        ]}
      >
        <GestureDetector gesture={composedGesture}>
          <Animated.View style={[styles.animatedContainer, animatedStyle]}>
            <VideoView
              style={StyleSheet.absoluteFillObject}
              player={player}
              allowsFullscreen={false}
              allowsPictureInPicture={false}
              nativeControls={false}
              contentFit="contain"
            />
          </Animated.View>
        </GestureDetector>
        
        {/* Brightness Preview Overlay */}
        {brightness !== undefined && Math.abs(brightness) > 0.01 && (
          <View 
            style={[
              StyleSheet.absoluteFillObject,
              { 
                backgroundColor: brightness > 0 ? '#FFFFFF' : '#000000',
                opacity: brightness > 0 ? brightness * 0.45 : Math.abs(brightness) * 0.75
              }
            ]} 
            pointerEvents="none"
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
    overflow: 'hidden',
  },
  canvasBounds: {
    backgroundColor: '#111', // Slightly different so user sees the borders
    overflow: 'hidden',
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  animatedContainer: {
    width: '100%',
    height: '100%',
  },
});
