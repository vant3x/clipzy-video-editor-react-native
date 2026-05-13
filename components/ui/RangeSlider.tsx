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

  // Current logical values
  const lowRef = useRef(initialLow ?? min);
  const highRef = useRef(initialHigh ?? max);

  // Animated positions
  const panLow = useRef(new Animated.Value(0)).current;
  const panHigh = useRef(new Animated.Value(0)).current;

  // Positions captured at gesture start (fix for dx-accumulation bug)
  const lowStartPos = useRef(0);
  const highStartPos = useRef(0);

  const toPos = (value: number, w: number) =>
    ((value - min) / (max - min)) * (w - THUMB_SIZE);

  const toValue = (pos: number, w: number) =>
    min + (pos / (w - THUMB_SIZE)) * (max - min);

  // Initialize / re-initialize when layout or range changes
  useEffect(() => {
    if (width > 0) {
      const lp = toPos(lowRef.current, width);
      const hp = toPos(highRef.current, width);
      panLow.setValue(lp);
      panHigh.setValue(hp);
    }
  }, [width, min, max]);

  const clampLow = (pos: number) =>
    Math.max(0, Math.min(pos, toPos(highRef.current, width) - THUMB_SIZE));

  const clampHigh = (pos: number) =>
    Math.max(toPos(lowRef.current, width) + THUMB_SIZE, Math.min(pos, width - THUMB_SIZE));

  const commitValues = (lowPos: number, highPos: number, isRelease: boolean) => {
    if (width === 0) return;
    lowRef.current = Math.max(min, Math.min(toValue(lowPos, width), max));
    highRef.current = Math.max(min, Math.min(toValue(highPos, width), max));
    if (isRelease) {
      onValueChanged(lowRef.current, highRef.current);
    } else {
      onValuesChanging?.(lowRef.current, highRef.current);
    }
  };

  const lowPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        // Capture starting position ONCE when finger touches thumb
        lowStartPos.current = toPos(lowRef.current, width);
      },
      onPanResponderMove: (_, gs) => {
        const newPos = clampLow(lowStartPos.current + gs.dx);
        panLow.setValue(newPos);
        commitValues(newPos, toPos(highRef.current, width), false);
      },
      onPanResponderRelease: (_, gs) => {
        const newPos = clampLow(lowStartPos.current + gs.dx);
        panLow.setValue(newPos);
        commitValues(newPos, toPos(highRef.current, width), true);
      },
    })
  ).current;

  const highPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        highStartPos.current = toPos(highRef.current, width);
      },
      onPanResponderMove: (_, gs) => {
        const newPos = clampHigh(highStartPos.current + gs.dx);
        panHigh.setValue(newPos);
        commitValues(toPos(lowRef.current, width), newPos, false);
      },
      onPanResponderRelease: (_, gs) => {
        const newPos = clampHigh(highStartPos.current + gs.dx);
        panHigh.setValue(newPos);
        commitValues(toPos(lowRef.current, width), newPos, true);
      },
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
