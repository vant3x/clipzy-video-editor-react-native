import React, { useState, useRef, useEffect } from 'react';
import { View, StyleSheet, PanResponder, Animated, LayoutChangeEvent, Image } from 'react-native';

interface RangeSliderProps {
  min: number;
  max: number;
  initialLow?: number;
  initialHigh?: number;
  onValueChanged: (low: number, high: number) => void;
  onValuesChanging?: (low: number, high: number) => void;
  activeColor?: string;
  thumbColor?: string;
  thumbnails?: string[];
}

export function RangeSlider({
  min,
  max,
  initialLow,
  initialHigh,
  onValueChanged,
  onValuesChanging,
  activeColor = '#3B82F6',
  thumbColor = '#FFFFFF',
  thumbnails = []
}: RangeSliderProps) {
  const [width, setWidth] = useState(0);
  const THUMB_SIZE = 28;

  // Dragging states to prevent prop updates from interrupting gestures
  const isDraggingLow = useRef(false);
  const isDraggingHigh = useRef(false);

  // Current logical values
  const lowRef = useRef(initialLow ?? min);
  const highRef = useRef(initialHigh ?? max);

  // Animated positions
  const panLow = useRef(new Animated.Value(0)).current;
  const panHigh = useRef(new Animated.Value(0)).current;

  // Positions captured at gesture start
  const lowStartPos = useRef(0);
  const highStartPos = useRef(0);

  // Store variables in refs so PanResponder callbacks never close over stale state/props
  const widthRef = useRef(width);
  const minRef = useRef(min);
  const maxRef = useRef(max);
  const onValueChangedRef = useRef(onValueChanged);
  const onValuesChangingRef = useRef(onValuesChanging);

  useEffect(() => { widthRef.current = width; }, [width]);
  useEffect(() => { minRef.current = min; }, [min]);
  useEffect(() => { maxRef.current = max; }, [max]);
  useEffect(() => { onValueChangedRef.current = onValueChanged; }, [onValueChanged]);
  useEffect(() => { onValuesChangingRef.current = onValuesChanging; }, [onValuesChanging]);

  const toPos = (value: number, w: number) => {
    const minVal = minRef.current;
    const maxVal = maxRef.current;
    if (maxVal - minVal <= 0) return 0;
    return ((value - minVal) / (maxVal - minVal)) * (w - THUMB_SIZE);
  };

  const toValue = (pos: number, w: number) => {
    const minVal = minRef.current;
    const maxVal = maxRef.current;
    if (w - THUMB_SIZE <= 0) return minVal;
    return minVal + (pos / (w - THUMB_SIZE)) * (maxVal - minVal);
  };

  // Sync lowRef and panLow when initialLow prop changes (if not actively dragging)
  useEffect(() => {
    if (!isDraggingLow.current) {
      lowRef.current = initialLow ?? min;
      if (width > 0) {
        panLow.setValue(toPos(lowRef.current, width));
      }
    }
  }, [initialLow, min, max, width]);

  // Sync highRef and panHigh when initialHigh prop changes (if not actively dragging)
  useEffect(() => {
    if (!isDraggingHigh.current) {
      highRef.current = initialHigh ?? max;
      if (width > 0) {
        panHigh.setValue(toPos(highRef.current, width));
      }
    }
  }, [initialHigh, min, max, width]);

  // Handle width or range boundary changes
  useEffect(() => {
    if (width > 0) {
      panLow.setValue(toPos(lowRef.current, width));
      panHigh.setValue(toPos(highRef.current, width));
    }
  }, [width, min, max]);

  const clampLow = (pos: number) =>
    Math.max(0, Math.min(pos, toPos(highRef.current, widthRef.current) - THUMB_SIZE));

  const clampHigh = (pos: number) =>
    Math.max(toPos(lowRef.current, widthRef.current) + THUMB_SIZE, Math.min(pos, widthRef.current - THUMB_SIZE));

  const commitValues = (lowPos: number, highPos: number, isRelease: boolean) => {
    const w = widthRef.current;
    if (w === 0) return;
    const minVal = minRef.current;
    const maxVal = maxRef.current;
    
    lowRef.current = Math.max(minVal, Math.min(toValue(lowPos, w), maxVal));
    highRef.current = Math.max(minVal, Math.min(toValue(highPos, w), maxVal));
    
    if (isRelease) {
      onValueChangedRef.current(lowRef.current, highRef.current);
    } else {
      onValuesChangingRef.current?.(lowRef.current, highRef.current);
    }
  };

  const lowPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        isDraggingLow.current = true;
        lowStartPos.current = toPos(lowRef.current, widthRef.current);
      },
      onPanResponderMove: (_, gs) => {
        const w = widthRef.current;
        const newPos = clampLow(lowStartPos.current + gs.dx);
        panLow.setValue(newPos);
        commitValues(newPos, toPos(highRef.current, w), false);
      },
      onPanResponderRelease: (_, gs) => {
        isDraggingLow.current = false;
        const w = widthRef.current;
        const newPos = clampLow(lowStartPos.current + gs.dx);
        panLow.setValue(newPos);
        commitValues(newPos, toPos(highRef.current, w), true);
      },
      onPanResponderTerminate: () => {
        isDraggingLow.current = false;
      }
    })
  ).current;

  const highPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        isDraggingHigh.current = true;
        highStartPos.current = toPos(highRef.current, widthRef.current);
      },
      onPanResponderMove: (_, gs) => {
        const w = widthRef.current;
        const newPos = clampHigh(highStartPos.current + gs.dx);
        panHigh.setValue(newPos);
        commitValues(toPos(lowRef.current, w), newPos, false);
      },
      onPanResponderRelease: (_, gs) => {
        isDraggingHigh.current = false;
        const w = widthRef.current;
        const newPos = clampHigh(highStartPos.current + gs.dx);
        panHigh.setValue(newPos);
        commitValues(toPos(lowRef.current, w), newPos, true);
      },
      onPanResponderTerminate: () => {
        isDraggingHigh.current = false;
      }
    })
  ).current;

  return (
    <View
      style={styles.container}
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
    >
      {/* Thumbnail strip background */}
      <View style={styles.trackBackground}>
        {thumbnails.length > 0 ? (
          <View style={{ flexDirection: 'row', width: '100%', height: '100%', overflow: 'hidden' }}>
            {thumbnails.map((uri, index) => (
              <Image
                key={index}
                source={{ uri }}
                style={{ flex: 1, height: '100%', resizeMode: 'cover' }}
              />
            ))}
          </View>
        ) : null}
      </View>

      {/* Active range overlay */}
      {width > 0 && (
        <Animated.View
          style={[
            styles.trackActive,
            {
              backgroundColor: activeColor,
              left: panLow.interpolate({
                inputRange: [0, width - THUMB_SIZE],
                outputRange: [THUMB_SIZE / 2, width - THUMB_SIZE / 2],
                extrapolate: 'clamp',
              }),
              right: panHigh.interpolate({
                inputRange: [0, width - THUMB_SIZE],
                outputRange: [width - THUMB_SIZE / 2, THUMB_SIZE / 2],
                extrapolate: 'clamp',
              }),
            },
          ]}
        />
      )}

      {/* Thumbs */}
      {width > 0 && (
        <>
          <Animated.View
            style={[styles.thumb, { left: panLow, backgroundColor: thumbColor }]}
            {...lowPanResponder.panHandlers}
          />
          <Animated.View
            style={[styles.thumb, { left: panHigh, backgroundColor: thumbColor }]}
            {...highPanResponder.panHandlers}
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: 48,
    justifyContent: 'center',
    width: '100%',
    position: 'relative',
  },
  trackBackground: {
    height: 48,
    backgroundColor: '#1F2937',
    borderRadius: 8,
    width: '100%',
    position: 'absolute',
    overflow: 'hidden',
  },
  trackActive: {
    height: 48,
    borderRadius: 8,
    position: 'absolute',
    opacity: 0.45,
  },
  thumb: {
    width: 28,
    height: 48,
    borderRadius: 6,
    position: 'absolute',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 5,
    borderWidth: 2.5,
    borderColor: '#E5E7EB',
  },
});
