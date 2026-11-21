import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { PaymentDialog } from "../modules/shared.jsx";
import { mockApi, renderPage } from "./helpers.jsx";

describe("pagamento", () => {
  test("sem métodos configurados mostra um aviso compacto e permite fechar", async () => {
    mockApi({
      "GET /payments/methods": {
        mode: "off",
        methods: [],
        upcoming: ["express", "reference", "paypay", "card", "paypal", "redotpay"]
      }
    });
    const onClose = vi.fn();
    renderPage(<PaymentDialog
      title="Comprar 100 estrelas"
      amountKz={1000}
      purpose="stars"
      onPay={vi.fn()}
      onDone={vi.fn()}
      onClose={onClose}
    />);

    expect(await screen.findByText("Pagamentos temporariamente indisponíveis")).toBeTruthy();
    expect(screen.queryByText("Em breve")).toBeNull();
    expect(screen.queryByPlaceholderText("EXEMPLO20")).toBeNull();
    expect(screen.queryByRole("button", { name: /Pagar/ })).toBeNull();
    fireEvent.click(screen.getByText("Fechar"));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
