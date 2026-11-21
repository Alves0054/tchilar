import { CreatePost } from "../create";

// Separador "Publicar": o ecrã de publicar, diretamente (a barra nativa não deixa um separador abrir outro ecrã).
export default function Publish() {
  return <CreatePost inTab />;
}
