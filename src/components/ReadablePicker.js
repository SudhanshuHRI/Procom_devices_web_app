import React from 'react';
import { StyleSheet } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import COLORS from '../constants/colors';

export default function ReadablePicker({ children, enabled = true, style, ...props }) {
  const color = enabled ? COLORS.text : '#475569';
  const backgroundColor = enabled ? COLORS.white : COLORS.softCard;

  return (
    <Picker
      {...props}
      enabled={enabled}
      mode="dropdown"
      numberOfLines={2}
      dropdownIconColor={color}
      dropdownIconRippleColor={COLORS.lightBlue}
      style={[styles.picker, style, { color, backgroundColor }]}
    >
      {React.Children.map(children, (item) => {
        if (!React.isValidElement(item)) return null;
        const itemColor = item.props.enabled === false ? '#475569' : color;
        return React.cloneElement(item, {
          color: itemColor,
          style: { ...item.props.style, color: itemColor, backgroundColor },
        });
      })}
    </Picker>
  );
}

ReadablePicker.Item = Picker.Item;

const styles = StyleSheet.create({
  picker: { minHeight: 48 },
});
