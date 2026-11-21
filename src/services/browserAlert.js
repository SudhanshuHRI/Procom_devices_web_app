export const Alert = {
  alert(title, message, buttons) {
    const text = [title, message].filter(Boolean).join('\n\n');
    const confirm = buttons?.find((button) => button.style !== 'cancel');
    if (buttons?.some((button) => button.style === 'cancel')) {
      if (window.confirm(text)) confirm?.onPress?.();
      return;
    }
    window.alert(text);
    confirm?.onPress?.();
  },
};
