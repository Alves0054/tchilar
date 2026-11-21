// Barra deslizante que não "salta" no iPhone e no iPad.
// O @react-native-community/slider controlado (value + onValueChange a cada passo) faz o polegar voltar atrás e
// tremer no iOS, porque o valor que regressa chega atrasado ao componente nativo. Aqui o valor só é passado ao nativo
// quando muda por fora (por exemplo "Repor" ou abrir o editor outra vez): enquanto se arrasta, o nativo manda.
import Slider from "@react-native-community/slider";
import { useEffect, useRef, useState } from "react";

export function StableSlider({ value, onValueChange, onSlidingComplete, ...props }) {
  const dragging = useRef(false);
  const last = useRef(value);
  const [nativeValue, setNativeValue] = useState(value);
  useEffect(() => {
    // Mudança vinda de fora (não do próprio arrastar): atualiza o polegar.
    if (!dragging.current && value !== last.current) setNativeValue(value);
    last.current = value;
  }, [value]);
  return <Slider {...props} value={nativeValue}
    onSlidingStart={() => { dragging.current = true; }}
    onValueChange={next => { last.current = next; onValueChange?.(next); }}
    onSlidingComplete={next => { dragging.current = false; last.current = next; setNativeValue(next); onSlidingComplete?.(next); }} />;
}
