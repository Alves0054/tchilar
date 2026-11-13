import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { LiveAudioMeters, liveSourceError } from "../modules/live.jsx";

// Stream falso: só o que o estúdio lê.
const fakeStream = (extra = {}) => ({ getAudioTracks: () => [], getVideoTracks: () => [], ...extra });

describe("estúdio dos diretos", () => {
  test("erros do browser aparecem em português e explicam o que fazer", () => {
    expect(liveSourceError({ name: "NotAllowedError" })).toMatch(/bloqueou/);
    expect(liveSourceError({ name: "NotReadableError" })).toMatch(/outro programa/);
    expect(liveSourceError({ name: "NotFoundError" })).toMatch(/não foi encontrado/);
    expect(liveSourceError({ name: "OverconstrainedError" })).toMatch(/não foi encontrado/);
    expect(liveSourceError({ name: "Outro", message: "Falhou." })).toBe("Falhou.");
  });

  test("no ecrã, microfone bloqueado e som do ecrã aparecem em separado", () => {
    render(<LiveAudioMeters stream={fakeStream({ isScreen: true, micStream: null, micError: "NotAllowedError", screenAudio: null })} />);
    expect(screen.getByText("Microfone")).toBeTruthy();
    expect(screen.getByText(/O Chrome bloqueou o microfone/)).toBeTruthy();
    expect(screen.getByText(/Sem som do ecrã/)).toBeTruthy();
  });

  test("microfone ocupado por outro programa tem a sua própria mensagem", () => {
    render(<LiveAudioMeters stream={fakeStream({ isScreen: true, micStream: null, micError: "NotReadableError", screenAudio: null })} />);
    expect(screen.getByText(/Discord, Zoom ou Teams/)).toBeTruthy();
  });

  test("câmara: uma só barra, e sem som mostra «Sem som»", () => {
    render(<LiveAudioMeters stream={fakeStream()} />);
    expect(screen.getByText("Nível do som")).toBeTruthy();
    expect(screen.getByRole("meter", { name: "Nível do som" })).toBeTruthy();
    expect(screen.getByText("Sem som")).toBeTruthy();
  });
});
