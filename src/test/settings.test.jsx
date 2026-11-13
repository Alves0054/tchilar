import { describe, expect, test, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { Settings } from "../modules/settings.jsx";
import { readDevicePrefs } from "../modules/core.jsx";
import { accessibilityViolations, mockApi, renderPage } from "./helpers.jsx";

const preferences = { notify: { interactions: true, people: true, messages: true, lives: true, community: true }, messages: "everyone", comments: "everyone" };

describe("Definições", () => {
  test("no telemóvel, /settings mostra a lista de áreas agrupadas", async () => {
    const { container } = renderPage(<Settings />, { path: "/settings", route: "/settings" });
    expect(screen.getByRole("heading", { level: 1, name: "Definições" })).toBeTruthy();
    for (const label of ["Conta", "Segurança", "Privacidade", "Notificações", "Aparência", "Ajuda e informação"]) {
      expect(screen.getByRole("link", { name: new RegExp(`^${label} `) })).toBeTruthy();
    }
    expect(await accessibilityViolations(container)).toEqual([]);
  });

  test("aparência: escolher o tema automático e o tamanho do texto", async () => {
    const setTheme = vi.fn();
    const { container } = renderPage(<Settings />, { path: "/settings/aparencia", route: "/settings/:section", theme: { setTheme } });
    fireEvent.click(screen.getByRole("radio", { name: /Automático/ }));
    expect(setTheme).toHaveBeenCalledWith("system");
    fireEvent.click(screen.getByRole("radio", { name: /Maior/ }));
    expect(readDevicePrefs().textSize).toBe("larger");
    expect(document.documentElement.dataset.textSize).toBe("larger");
    fireEvent.click(screen.getByRole("switch", { name: /Reduzir animações/ }));
    expect(document.documentElement.dataset.motion).toBe("reduce");
    expect(await accessibilityViolations(container)).toEqual([]);
  });

  test("privacidade: escolher quem envia mensagens grava na conta", async () => {
    const calls = mockApi({
      "GET /auth/me/preferences": { preferences },
      "PATCH /auth/me/preferences": body => ({ preferences: { ...preferences, ...body } }),
      "GET /blocks": { blocked: [] },
      "GET /auth/me/audience": { provinces: ["Luanda", "Benguela"], province: "", birth_date: "", show_province_to_brands: false }
    });
    const { container } = renderPage(<Settings />, { path: "/settings/privacidade", route: "/settings/:section" });
    const option = await screen.findByRole("radio", { name: /Só quem eu sigo.*conversa/ });
    fireEvent.click(option);
    await waitFor(() => expect(calls.some(call => call.method === "PATCH" && call.body?.messages === "following")).toBe(true));
    expect(await screen.findByText("Guardado")).toBeTruthy();
    expect(await accessibilityViolations(container)).toEqual([]);
  });

  test("notificações: desligar uma categoria e ver o erro se a gravação falhar", async () => {
    mockApi({ "GET /auth/me/preferences": { preferences } });
    globalThis.fetch = (fetch => async (url, options = {}) => (options.method === "PATCH"
      ? new Response(JSON.stringify({ error: "Sem ligação ao servidor." }), { status: 500, headers: { "Content-Type": "application/json" } })
      : fetch(url, options)))(globalThis.fetch);
    renderPage(<Settings />, { path: "/settings/notificacoes", route: "/settings/:section" });
    const toggle = await screen.findByRole("switch", { name: /Diretos/ });
    expect(toggle.checked).toBe(true);
    fireEvent.click(toggle);
    expect(await screen.findByRole("alert")).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("switch", { name: /Diretos/ }).checked).toBe(true));
  });

  test("áreas da conta pedem sessão iniciada", () => {
    renderPage(<Settings />, { path: "/settings/conta", route: "/settings/:section", user: null });
    expect(screen.getByText("Inicia sessão para ver esta área")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Iniciar sessão" }).getAttribute("href")).toBe("/login");
  });
});
