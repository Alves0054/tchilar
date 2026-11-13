// Limpa o ecrã simulado e o armazenamento entre testes.
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// O jsdom não desenha a página: deslocar não faz nada.
window.scrollTo = () => {};

afterEach(() => {
  cleanup();
  localStorage.clear();
  delete document.documentElement.dataset.textSize;
  delete document.documentElement.dataset.motion;
  vi.restoreAllMocks();
});
