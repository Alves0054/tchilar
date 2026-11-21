-- PayPay Africa nos pagamentos (pagamento aprovado na app PayPay, em kwanzas).
ALTER TABLE local_payments DROP CONSTRAINT IF EXISTS local_payments_method_check;
ALTER TABLE local_payments ADD CONSTRAINT local_payments_method_check CHECK (method IN ('express','reference','paypal','redotpay','paypay'));
