// Conteúdo protegido (grupos secretos): enquanto o ecrã está aberto, não deixa fazer capturas nem gravar o ecrã.
// Android: bloqueia capturas e gravações (o ecrã sai preto). iPhone (iOS 13+): bloqueia gravações e capturas.
import * as ScreenCapture from "expo-screen-capture";
import { useEffect } from "react";

export function useProtectScreen(active, key) {
  useEffect(() => {
    if (!active) return undefined;
    ScreenCapture.preventScreenCaptureAsync(key).catch(() => {});
    return () => { ScreenCapture.allowScreenCaptureAsync(key).catch(() => {}); };
  }, [active, key]);
}
