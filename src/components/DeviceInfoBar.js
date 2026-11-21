import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import COLORS from '../constants/colors';

export default function DeviceInfoBar({ deviceName, deviceVersion }) {
  return (
    <View style={styles.deviceInfoBar}>
      <View style={styles.deviceInfoItem}>
        <Text style={styles.deviceInfoLabel}>Device Name</Text>
        <Text style={styles.deviceInfoValue}>{deviceName}</Text>
      </View>

      <View style={styles.deviceInfoItem}>
        <Text style={styles.deviceInfoLabel}>Version</Text>
        <Text style={styles.deviceInfoValue}>{deviceVersion}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  deviceInfoBar: {
    flexDirection: 'row',
    backgroundColor: COLORS.lightBlue,
    padding: 12,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },

  deviceInfoItem: {
    flex: 1,
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },

  deviceInfoLabel: {
    fontSize: 12,
    color: COLORS.mutedText,
    marginBottom: 4,
  },

  deviceInfoValue: {
    fontSize: 15,
    color: COLORS.primary,
    fontWeight: '800',
  },
});