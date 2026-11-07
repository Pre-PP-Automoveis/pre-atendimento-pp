-- Isabel, consultora de vendas (Kauan, 03/11/2026): entra no rodízio com Leo, Rayan e Brendon. Já respondia os leads pelo
-- aplicativo desde 23/10 sem estar no sistema. O celular dela entra como do time: escrevendo para a loja, a Bia não responde.
insert into pa_vendedores (loja_id, nome, usuario, whatsapp, ativo, ordem, no_rodizio, gerente, admin)
select l.id, 'Isabel', 'isabelppautomoveis', '5511943997554', true, 9, true, false, false from pa_lojas l
where l.slug = 'pp-automoveis' and not exists (select 1 from pa_vendedores where usuario = 'isabelppautomoveis');
