// Vídeo de uma publicação, com as edições guardadas em post.video_edit (como no site):
// corte (início/fim, em ciclo), velocidade, volume do som original, espelhar, texto, efeito e música por cima.
// "playing" controla de fora (ex.: só toca o Reel que está no ecrã).
import { useAudioPlayer } from "expo-audio";
import { useVideoPlayer, VideoView } from "expo-video";
import { useEffect, useMemo, useRef } from "react";
import { StyleSheet, Text, View } from "react-native";
import { mediaUri } from "../lib/api";
import { DEFAULT_VIDEO_EDIT, MUSIC_FADE_SECONDS, videoLook } from "../lib/media-edit";
import { colors } from "../lib/theme";

export function VideoPost({ uri, playing = false, style, fullScreen = false, muted = false, edit = null, music = null, controls }) {
  const settings = useMemo(() => ({ ...DEFAULT_VIDEO_EDIT, ...(edit || {}) }), [edit]);
  const start = settings.start || 0;
  const end = settings.end ?? null;
  const originalVolume = settings.muted ? 0 : Math.min(1, Math.max(0, settings.originalVolume ?? 1));
  const musicSrc = settings.music && music?.audio_url ? mediaUri(music.audio_url) : (settings.music && music?.src) || null;
  const musicRef = useRef(null);

  const player = useVideoPlayer(uri, item => {
    item.loop = end === null && start === 0;
    item.timeUpdateEventInterval = 0.25;
  });
  const audio = useAudioPlayer(musicSrc ? { uri: musicSrc } : null);
  musicRef.current = musicSrc ? audio : null;

  useEffect(() => {
    player.muted = muted || originalVolume === 0;
    player.volume = originalVolume || 1;
    player.playbackRate = settings.speed || 1;
    player.preservesPitch = true;
  }, [player, muted, originalVolume, settings.speed]);

  // Corte: começa no início escolhido e volta lá quando chega ao fim.
  useEffect(() => {
    if (start > 0) player.currentTime = start;
    const timeSub = player.addListener("timeUpdate", ({ currentTime }) => {
      const clipEnd = end ?? player.duration;
      if ((end !== null && currentTime >= end - 0.05) || currentTime < start - 0.5) player.currentTime = start;
      // Música: segue o vídeo (toca à velocidade normal, com entrada e saída suaves).
      const track = musicRef.current;
      if (!track || !settings.music) return;
      const elapsed = Math.max(0, currentTime - start) / (settings.speed || 1);
      const expected = (settings.music.offset || 0) + elapsed;
      if (Math.abs(track.currentTime - expected) > 0.4) track.seekTo(expected).catch(() => {});
      const length = Math.max(0.1, ((clipEnd || 0) - start) / (settings.speed || 1));
      const fade = settings.music.fade !== false ? Math.min(1, elapsed / MUSIC_FADE_SECONDS, Math.max(0, length - elapsed) / MUSIC_FADE_SECONDS) : 1;
      track.volume = muted ? 0 : Math.max(0, Math.min(1, (settings.music.volume ?? 1) * fade));
    });
    const playSub = player.addListener("playingChange", ({ isPlaying }) => {
      const track = musicRef.current;
      if (!track) return;
      if (isPlaying) track.play(); else track.pause();
    });
    return () => { timeSub.remove(); playSub.remove(); };
  }, [player, start, end, settings.music, settings.speed, muted]);

  useEffect(() => {
    if (playing) player.play(); else { player.pause(); musicRef.current?.pause(); }
  }, [playing, player]);
  useEffect(() => () => { musicRef.current?.pause(); }, []);

  const look = videoLook(settings);
  const hasText = Boolean(settings.text?.trim());
  return <View style={[styles.video, style]}>
    <VideoView player={player} style={[StyleSheet.absoluteFill, settings.mirror && styles.mirror, look.style]}
      surfaceType={look.style ? "textureView" : undefined}
      contentFit={fullScreen ? "cover" : "contain"}
      nativeControls={controls ?? (!fullScreen && !hasText && !look.tint)} allowsFullscreen allowsPictureInPicture={false} />
    {look.tint && <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: look.tint }]} />}
    {hasText && <View pointerEvents="none" style={[styles.textWrap, styles[`pos_${settings.textPosition}`]]}>
      <Text style={[styles.text, styles[`text_${settings.textStyle}`]]}>{settings.text}</Text>
    </View>}
  </View>;
}

const styles = StyleSheet.create({
  video: { backgroundColor: colors.ink, overflow: "hidden" },
  mirror: { transform: [{ scaleX: -1 }] },
  textWrap: { position: "absolute", left: "8%", right: "8%", alignItems: "center" },
  pos_top: { top: "13%" },
  pos_center: { top: "45%" },
  pos_bottom: { bottom: "18%" },
  text: { fontSize: 24, fontWeight: "800", textAlign: "center", color: "#fff", lineHeight: 28 },
  text_clean: { textShadowColor: "rgba(0,0,0,0.6)", textShadowRadius: 8, textShadowOffset: { width: 0, height: 2 } },
  text_box: { color: colors.ink, backgroundColor: "#fff", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, overflow: "hidden" },
  text_coral: { color: colors.ink, backgroundColor: colors.accent, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, overflow: "hidden" }
});
