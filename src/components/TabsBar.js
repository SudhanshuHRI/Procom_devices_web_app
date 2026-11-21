import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity } from 'react-native';
import COLORS from '../constants/colors';
import { TABS } from '../constants/tabs';

export default function TabsBar({ activeTab, onChangeTab }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.tabScroll}
      contentContainerStyle={styles.tabContainer}
    >
      {TABS.map(tab => (
        <TouchableOpacity
          key={tab}
          style={[styles.tab, activeTab === tab && styles.activeTab]}
          onPress={() => onChangeTab(tab)}
        >
          <Text
            style={[
              styles.tabText,
              activeTab === tab && styles.activeTabText,
            ]}
          >
            {tab}
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  tabScroll: {
    backgroundColor: COLORS.white,
    maxHeight: 56,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    marginTop:10
  },

  tabContainer: {
    paddingHorizontal: 8,
    alignItems: 'center',
  },

  tab: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginRight: 6,
    borderRadius: 10,
    backgroundColor: COLORS.softCard,
    borderWidth: 1,
    borderColor: COLORS.border,
  },

  activeTab: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },

  tabText: {
    color: COLORS.primary,
    fontSize: 14,
    fontWeight: '700',
  },

  activeTabText: {
    color: COLORS.white,
  },
});