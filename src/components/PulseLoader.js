import React, { useEffect, useRef } from 'react';
import {
  Animated,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import COLORS from '../constants/colors';

export default function PulseLoader({ text = 'Please wait...' }) {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const opacityAnim = useRef(new Animated.Value(0.7)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(scaleAnim, {
            toValue: 1.35,
            duration: 700,
            useNativeDriver: true,
          }),
          Animated.timing(scaleAnim, {
            toValue: 1,
            duration: 700,
            useNativeDriver: true,
          }),
        ]),
        Animated.sequence([
          Animated.timing(opacityAnim, {
            toValue: 0.25,
            duration: 700,
            useNativeDriver: true,
          }),
          Animated.timing(opacityAnim, {
            toValue: 0.7,
            duration: 700,
            useNativeDriver: true,
          }),
        ]),
      ]),
    );

    animation.start();

    return () => animation.stop();
  }, [opacityAnim, scaleAnim]);

  return (
    <View style={styles.overlay}>
      <View style={styles.loaderCard}>
        <View style={styles.pulseWrapper}>
          <Animated.View
            style={[
              styles.pulseCircle,
              {
                transform: [{ scale: scaleAnim }],
                opacity: opacityAnim,
              },
            ]}
          />

          <View style={styles.innerCircle} />
        </View>

        <Text style={styles.loaderText}>{text}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255, 255, 255, 0.78)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 999,
  },

  loaderCard: {
    backgroundColor: COLORS.white,
    borderRadius: 18,
    paddingVertical: 26,
    paddingHorizontal: 30,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    elevation: 8,
    minWidth: 220,
  },

  pulseWrapper: {
    width: 74,
    height: 74,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },

  pulseCircle: {
    position: 'absolute',
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: COLORS.primary,
  },

  innerCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: COLORS.primary,
  },

  loaderText: {
    fontSize: 15,
    fontWeight: '800',
    color: COLORS.primary,
    textAlign: 'center',
  },
});