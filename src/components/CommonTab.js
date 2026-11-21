import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import COLORS from '../constants/colors';

export default function CommonTab({ activeTab }) {
  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>{activeTab}</Text>

      <View style={styles.emptyBox}>
        <Text style={styles.emptyTitle}>{activeTab} Page</Text>
        <Text style={styles.emptyText}>
          This page is ready. You can add fields, buttons, tables, or settings here.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.white,
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    elevation: 2,
    marginBottom: 20,
  },

  sectionTitle: {
    backgroundColor: COLORS.primary,
    color: COLORS.white,
    fontSize: 22,
    fontWeight: '900',
    textAlign: 'center',
    paddingVertical: 10,
    borderRadius: 12,
    marginBottom: 14,
  },

  emptyBox: {
    backgroundColor: COLORS.softCard,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 14,
    padding: 24,
    alignItems: 'center',
  },

  emptyTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: COLORS.primary,
    marginBottom: 8,
  },

  emptyText: {
    fontSize: 15,
    color: COLORS.mutedText,
    textAlign: 'center',
    lineHeight: 22,
  },
});