import { router } from "expo-router";
import { Text } from "react-native";
import { colors } from "../lib/theme";

// Texto de uma publicação com as hashtags clicáveis: abrem a pesquisa com as publicações dessa hashtag.
const TAG_SPLIT = /(#[\p{L}\p{N}_]{1,50})/u;
export function TextWithTags({ text, style, numberOfLines }) {
  return <Text style={style} numberOfLines={numberOfLines}>
    {String(text).split(TAG_SPLIT).map((part, index) => index % 2
      ? <Text key={index} style={{ color: colors.primary, fontWeight: "700" }}
        onPress={() => router.push({ pathname: "/search", params: { q: part } })}>{part}</Text>
      : part)}
  </Text>;
}
