// Fundos dos stories de texto. As chaves são as mesmas do servidor (server/story-backgrounds.json),
// para um story criado no telemóvel aparecer igual no site e vice-versa.
export const STORY_COLORS = [
  { key: "oceano", label: "Oceano", colors: ["#0077B6", "#00B4D8"] },
  { key: "noite", label: "Noite de Luanda", colors: ["#03233A", "#0077B6"] },
  { key: "coral", label: "Coral", colors: ["#FF6B6B", "#FFB86B"] },
  { key: "lagoa", label: "Lagoa", colors: ["#00B4D8", "#2EC4A6"] },
  { key: "por-do-sol", label: "Pôr do sol", colors: ["#7A2E5F", "#FF6B6B", "#FFB86B"] },
  { key: "palmeira", label: "Palmeira", colors: ["#1E8A5A", "#2EC4A6"] },
  { key: "tinta", label: "Azul-escuro", colors: ["#03233A", "#03233A"] },
  { key: "vermelho", label: "Vermelho", colors: ["#E05252", "#E05252"] }
];
export const STORY_THEMES = [
  { key: "tchilar", label: "Tchilar", image: require("../../assets/story-backgrounds/tchilar.png") },
  { key: "tchilar-noite", label: "Tchilar Noite", image: require("../../assets/story-backgrounds/tchilar-noite.png") },
  { key: "tchilar-vermelho", label: "Tchilar Vermelho", image: require("../../assets/story-backgrounds/tchilar-vermelho.png") },
  { key: "luanda", label: "Marginal de Luanda", image: require("../../assets/story-backgrounds/luanda.png") },
  { key: "ilha", label: "Ilha", image: require("../../assets/story-backgrounds/ilha.png") },
  { key: "kizomba", label: "Kizomba", image: require("../../assets/story-backgrounds/kizomba.png") },
  { key: "futebol", label: "Futebol", image: require("../../assets/story-backgrounds/futebol.png") },
  { key: "embondeiro", label: "Embondeiro", image: require("../../assets/story-backgrounds/embondeiro.png") },
  { key: "festa", label: "Festa", image: require("../../assets/story-backgrounds/festa.png") },
  { key: "estrelas", label: "Estrelas", image: require("../../assets/story-backgrounds/estrelas.png") }
];
export const DEFAULT_STORY_BACKGROUND = "tchilar";
export const findBackground = key =>
  STORY_COLORS.find(item => item.key === key) ||
  STORY_THEMES.find(item => item.key === (key === "biva" ? "tchilar" : key)) ||
  STORY_THEMES[0];
