import { describe, expect, test } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { isStaleChunkError, PageErrorBoundary } from "../modules/errors.jsx";

function Broken() {
  throw new Error("algo correu mal");
}

describe("fronteira de erro das páginas", () => {
  test("uma página que falha mostra a mensagem e não apaga o resto", () => {
    globalThis.fetch = async () => new Response(null, { status: 204 });
    const original = console.error;
    console.error = () => {};
    try {
      render(<div><p>Menu do Tchilar</p><PageErrorBoundary><Broken /></PageErrorBoundary></div>);
    } finally {
      console.error = original;
    }
    expect(screen.getByText("Menu do Tchilar")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toMatch(/Esta página teve um problema/);
    expect(screen.getByText(/Referência:/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tentar outra vez" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Tentar outra vez" }));
  });

  test("reconhece ficheiros de uma versão antiga que já não existem", () => {
    expect(isStaleChunkError(new TypeError("Failed to fetch dynamically imported module: /assets/live-abc.js"))).toBe(true);
    expect(isStaleChunkError(new TypeError("Importing a module script failed."))).toBe(true);
    expect(isStaleChunkError(new Error("x is undefined"))).toBe(false);
  });
});
