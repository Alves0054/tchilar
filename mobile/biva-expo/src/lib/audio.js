import { createAudioPlayer } from "expo-audio";

// Duração (segundos) de um ficheiro de áudio local: o servidor pede-a ao carregar uma música.
export function audioDuration(uri, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const player = createAudioPlayer({ uri });
    const started = Date.now();
    const timer = setInterval(() => {
      if (player.isLoaded && player.duration > 0) {
        clearInterval(timer);
        const seconds = player.duration;
        player.remove();
        resolve(seconds);
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        player.remove();
        reject(new Error("Não foi possível ler este ficheiro de áudio."));
      }
    }, 150);
  });
}
