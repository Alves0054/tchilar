import { useVideoPlayer, VideoView } from "expo-video";
import { useEffect } from "react";
import { StyleSheet } from "react-native";
import { colors } from "../lib/theme";

// Vídeo de uma publicação. "playing" controla de fora (ex.: só toca o Reel que está no ecrã).
export function VideoPost({ uri, playing = false, style, fullScreen = false, muted = false }) {
  const player = useVideoPlayer(uri, item => { item.loop = true; item.muted = muted; });
  useEffect(() => {
    if (playing) player.play(); else player.pause();
  }, [playing, player]);
  return <VideoView player={player} style={[styles.video, style]} contentFit={fullScreen ? "cover" : "contain"}
    nativeControls={!fullScreen} allowsFullscreen allowsPictureInPicture={false} />;
}

const styles = StyleSheet.create({ video: { backgroundColor: colors.ink } });
