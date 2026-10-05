-- Condições que a loja autoriza o robô a afirmar (financiamento, cartão, troca), uma por linha.
-- Garantia, perícia, laudo e leilão ficam fora de propósito: decisão do Kauan em 05/10/2026.
alter table pa_lojas add column if not exists fatos text;
