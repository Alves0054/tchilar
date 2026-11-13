import { describe, expect, test } from "vitest";
import { applyDevicePrefs, readDevicePrefs, saveDevicePrefs } from "../modules/core.jsx";
import { Auth } from "../modules/auth.jsx";
import { accessibilityViolations, renderPage } from "./helpers.jsx";

describe("preferências do dispositivo", () => {
  test("valores por omissão e valores estragados no armazenamento", () => {
    expect(readDevicePrefs()).toEqual({ textSize: "normal", autoplay: true, reduceMotion: false });
    localStorage.setItem("biva-device", "{isto não é json");
    expect(readDevicePrefs().textSize).toBe("normal");
    localStorage.setItem("biva-device", JSON.stringify({ textSize: "gigante", autoplay: false }));
    expect(readDevicePrefs()).toEqual({ textSize: "normal", autoplay: false, reduceMotion: false });
  });

  test("gravar aplica logo à página e sobrevive a uma nova leitura", () => {
    saveDevicePrefs({ textSize: "large", autoplay: true, reduceMotion: true });
    expect(document.documentElement.dataset.textSize).toBe("large");
    expect(document.documentElement.dataset.motion).toBe("reduce");
    expect(readDevicePrefs().reduceMotion).toBe(true);
    applyDevicePrefs({ textSize: "normal", autoplay: true, reduceMotion: false });
    expect(document.documentElement.dataset.motion).toBeUndefined();
  });
});

describe("entrada", () => {
  test("o formulário de entrar tem etiquetas e não tem falhas de acessibilidade", async () => {
    const { container } = renderPage(<Auth mode="login" />, { path: "/login", route: "/login", user: null });
    expect(await accessibilityViolations(container)).toEqual([]);
  });
});
