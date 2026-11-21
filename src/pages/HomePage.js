import React from 'react';
import {
  Image,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import COLORS from '../constants/colors';

export default function HomePage({ onConnectDevice }) {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.homeContainer}>
        <Image
          source={require('../../assets/logo.png')}
          style={styles.logo}
          resizeMode="contain"
        />

        <Text style={styles.homeTitle}>Controller Setup</Text>

        <Text style={styles.homeDescription}>
          Connect the controller to a USB port on this computer.
        </Text>

        <TouchableOpacity style={styles.primaryButton} onPress={onConnectDevice}>
          <Text style={styles.primaryButtonText}>Connect Device</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: COLORS.white,
  },

  homeContainer: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.white,
  },

  logo: {
    width: 300,
    height: 90,
    marginBottom: 36,
  },

  homeTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: COLORS.primary,
    marginBottom: 12,
    textAlign: 'center',
  },

  homeDescription: {
    fontSize: 17,
    color: COLORS.mutedText,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 32,
  },

  primaryButton: {
    width: '100%',
    backgroundColor: COLORS.primary,
    paddingVertical: 16,
    marginBottom: 12,
    borderRadius: 14,
    alignItems: 'center',
    elevation: 4,
  },

  primaryButtonText: {
    color: COLORS.white,
    fontSize: 17,
    fontWeight: '800',
  },
});
