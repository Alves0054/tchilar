// Utilitários dos testes: contas e tema simulados, rotas, e verificação de acessibilidade com axe.
import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import axe from "axe-core";
import { ThemeContext, UserContext } from "../modules/core.jsx";

export const testUser = {
  id: 7, username: "marta", email: "marta@example.com", display_name: "Marta Kiala", is_creator: true,
  email_verified: true, created_at: "2026-01-15T10:00:00Z", bio: "", avatar_url: "", cover_url: ""
};

export function renderPage(element, { path = "/", route = "*", user = testUser, theme = {} } = {}) {
  const themeValue = { theme: "light", themePreference: "light", setTheme: () => {}, ...theme };
  return render(
    <ThemeContext.Provider value={themeValue}>
      <UserContext.Provider value={{ user, refreshUser: async () => {}, authReady: true }}>
        <MemoryRouter initialEntries={[path]}>
          <Routes><Route path={route} element={element} /></Routes>
        </MemoryRouter>
      </UserContext.Provider>
    </ThemeContext.Provider>
  );
}

// Respostas falsas da API, por caminho. Devolve a lista de pedidos feitos para os testes verificarem.
export function mockApi(routes) {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const path = String(url).replace(/^.*\/api/, "");
    const method = options.method || "GET";
    calls.push({ method, path, body: options.body ? JSON.parse(options.body) : undefined });
    const handler = routes[`${method} ${path}`] ?? routes[path];
    const body = typeof handler === "function" ? handler(options.body ? JSON.parse(options.body) : undefined) : handler;
    return new Response(JSON.stringify(body ?? {}), { status: body === undefined ? 404 : 200, headers: { "Content-Type": "application/json" } });
  };
  return calls;
}

// Falhas de acessibilidade (o contraste de cores não se mede em jsdom: verifica-se no browser).
export async function accessibilityViolations(container) {
  const result = await axe.run(container, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
  return result.violations.map(violation => `${violation.id}: ${violation.help} (${violation.nodes.length})`);
}
