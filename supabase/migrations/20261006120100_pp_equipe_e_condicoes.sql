-- Pedro Paulo: equipe e condições confirmadas pelo Leo (Kauan, 06/10/2026).
-- No rodízio: Rayan, Daniel, Rafa e Leo. Fora (recebem o que for pedido pelo nome ou passado pelo Leo):
-- Brendon (vendedor de rua), Keila (financeiro) e Pedro (dono, atende os próprios clientes e as indicações).
-- O Leo liga e desliga quem está no rodízio pelo painel dele.
insert into pa_vendedores (loja_id, nome, ordem, no_rodizio, gerente)
select l.id, v.nome, v.ordem, v.no_rodizio, v.gerente
from pa_lojas l, (values
  ('Rayan', 1, true, false), ('Daniel', 2, true, false), ('Rafa', 3, true, false), ('Leo', 4, true, true),
  ('Brendon', 5, false, false), ('Keila', 6, false, false), ('Pedro', 7, false, false)
) as v(nome, ordem, no_rodizio, gerente)
where l.slug = 'pp-automoveis'
  and not exists (select 1 from pa_vendedores x where x.loja_id = l.id and x.nome = v.nome);

update pa_lojas set
  gerente_nome = 'Leo',
  fatos = E'- Financiamento em até 60x. Aprovação, entrada e parcela dependem da análise de crédito, feita pelo consultor.\n- Parcelamento no cartão de crédito em até 21x.\n- A loja aceita carro na troca. A avaliação é feita pelo consultor, de preferência com o carro na loja.\n- A loja aceita troca com troco: quem tem um carro de valor maior pode trocar por um mais barato e receber a diferença. Quanto volta depende da avaliação do consultor.'
where slug = 'pp-automoveis';
