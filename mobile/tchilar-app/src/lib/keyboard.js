// Quanto o teclado tapa uma vista (em píxeis). Serve para levantar barras e botões por cima do teclado
// em qualquer telemóvel: no Android com ecrã inteiro (edge-to-edge) e dentro dos separadores, onde o
// KeyboardAvoidingView sozinho não chega.
import { useEffect, useRef, useState } from "react";
import { Dimensions, Keyboard, Platform } from "react-native";

export function useKeyboardOverlap() {
  const ref = useRef(null);
  const [overlap, setOverlap] = useState(0);
  useEffect(() => {
    const show = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hide = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const onShow = event => {
      const keyboardTop = event.endCoordinates?.screenY ?? Dimensions.get("window").height - event.endCoordinates.height;
      if (!ref.current?.measureInWindow) { setOverlap(event.endCoordinates.height); return; }
      ref.current.measureInWindow((_x, y, _width, height) => setOverlap(Math.max(0, y + height - keyboardTop)));
    };
    const subs = [Keyboard.addListener(show, onShow), Keyboard.addListener(hide, () => setOverlap(0))];
    return () => subs.forEach(sub => sub.remove());
  }, []);
  return [ref, overlap];
}
