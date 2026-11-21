import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import COLORS from '../constants/colors';

export default function DeviceHeader({ title, onBack,deviceVersion }) {
  return (
    <View style={styles.appHeader}>
      <View>
        <Text style={styles.companyName}>MRM PROCOM Pvt. Ltd.</Text>
        <Text style={styles.softwareText}>Device: {title}</Text>
        <Text style={styles.softwareText}>Version: {deviceVersion}</Text>
      </View>

      <TouchableOpacity style={styles.backButton} onPress={onBack}>
        <Text style={styles.backButtonText}>Home</Text>
      </TouchableOpacity>
    </View>
  );
}



const styles = StyleSheet.create({
  appHeader: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 16,
    paddingTop: 40,
    paddingBottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    elevation: 3,
  },

  companyName: {
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.white,
    lineHeight: 22,
  },

  softwareText: {
    marginTop: 4,
    fontSize: 14,
    color: '#EAF0FF',
    fontWeight: '600',
    lineHeight: 20,
  },

  backButton: {
    backgroundColor: COLORS.white,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },

  backButtonText: {
    color: COLORS.primary,
    fontWeight: '700',
  },
});