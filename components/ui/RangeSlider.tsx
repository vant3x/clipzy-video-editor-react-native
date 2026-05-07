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
  const THUMB_SIZE = 24;

  const lowRef = useRef(initialLow ?? min);
  const highRef = useRef(initialHigh ?? max);

  const panLow = useRef(new Animated.Value(0)).current;
  const panHigh = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (width > 0) {
      const lowPos = ((lowRef.current - min) / (max - min)) * (width - THUMB_SIZE);
      const highPos = ((highRef.current - min) / (max - min)) * (width - THUMB_SIZE);
      panLow.setValue(lowPos);
      panHigh.setValue(highPos);
    }
  }, [width, min, max]);

  const updateValues = (newLowPos: number, newHighPos: number, isRelease: boolean) => {
    if (width === 0) return;
    const range = max - min;
    const lowVal = min + (newLowPos / (width - THUMB_SIZE)) * range;
    const highVal = min + (newHighPos / (width - THUMB_SIZE)) * range;
    
    lowRef.current = Math.max(min, Math.min(lowVal, highRef.current - 0.1));
    highRef.current = Math.min(max, Math.max(highVal, lowRef.current + 0.1));

    if (isRelease) {
      onValueChanged(lowRef.current, highRef.current);
    } else if (onValuesChanging) {
      onValuesChanging(lowRef.current, highRef.current);
    }
  };

  const lowPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderMove: (_, gestureState) => {
        let newPos = ((lowRef.current - min) / (max - min)) * (width - THUMB_SIZE) + gestureState.dx;
        const maxPos = ((highRef.current - min) / (max - min)) * (width - THUMB_SIZE) - THUMB_SIZE;
        newPos = Math.max(0, Math.min(newPos, maxPos));
        panLow.setValue(newPos);
        updateValues(newPos, ((highRef.current - min) / (max - min)) * (width - THUMB_SIZE), false);
      },
      onPanResponderRelease: (_, gestureState) => {
        let newPos = ((lowRef.current - min) / (max - min)) * (width - THUMB_SIZE) + gestureState.dx;
        const maxPos = ((highRef.current - min) / (max - min)) * (width - THUMB_SIZE) - THUMB_SIZE;
        newPos = Math.max(0, Math.min(newPos, maxPos));
        panLow.setValue(newPos);
        updateValues(newPos, ((highRef.current - min) / (max - min)) * (width - THUMB_SIZE), true);
      },
    })
  ).current;

  const highPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderMove: (_, gestureState) => {
        let newPos = ((highRef.current - min) / (max - min)) * (width - THUMB_SIZE) + gestureState.dx;
        const minPos = ((lowRef.current - min) / (max - min)) * (width - THUMB_SIZE) + THUMB_SIZE;
        newPos = Math.max(minPos, Math.min(newPos, width - THUMB_SIZE));
        panHigh.setValue(newPos);
        updateValues(((lowRef.current - min) / (max - min)) * (width - THUMB_SIZE), newPos, false);
      },
      onPanResponderRelease: (_, gestureState) => {
        let newPos = ((highRef.current - min) / (max - min)) * (width - THUMB_SIZE) + gestureState.dx;
        const minPos = ((lowRef.current - min) / (max - min)) * (width - THUMB_SIZE) + THUMB_SIZE;
        newPos = Math.max(minPos, Math.min(newPos, width - THUMB_SIZE));
        panHigh.setValue(newPos);
        updateValues(((lowRef.current - min) / (max - min)) * (width - THUMB_SIZE), newPos, true);
      },
    })
  ).current;

  return (
    <View 
      style={styles.container} 
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
    >
      <View style={styles.trackBackground}>
        {thumbnails.length > 0 && (
          <View style={{ flexDirection: 'row', width: '100%', height: '100%', overflow: 'hidden', borderRadius: 3 }}>
            {thumbnails.map((uri, index) => (
              <Image key={index} source={{ uri }} style={{ flex: 1, height: '100%', resizeMode: 'cover' }} />
            ))}
          </View>
        )}
      </View>
      {width > 0 && (
        <Animated.View 
          style={[
            styles.trackActive, 
            { 
              backgroundColor: activeColor,
              left: panLow.interpolate({
                inputRange: [0, width],
                outputRange: [THUMB_SIZE / 2, width + THUMB_SIZE / 2]
              }),
              right: panHigh.interpolate({
                inputRange: [0, width],
                outputRange: [width - THUMB_SIZE / 2, -THUMB_SIZE / 2]
              })
            }
          ]} 
        />
      )}
      
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
    height: 40,
    justifyContent: 'center',
    width: '100%',
    position: 'relative',
  },
  trackBackground: {
    height: 40,
    backgroundColor: '#1F2937',
    borderRadius: 8,
    width: '100%',
    position: 'absolute',
    overflow: 'hidden',
  },
  trackActive: {
    height: 40,
    borderRadius: 8,
    position: 'absolute',
    opacity: 0.5,
  },
  thumb: {
    width: 24,
    height: 24,
    borderRadius: 12,
    position: 'absolute',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 4,
    borderWidth: 2,
    borderColor: '#E5E7EB',
  },
});
