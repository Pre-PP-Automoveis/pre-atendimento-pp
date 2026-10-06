-- Marcos, o outro sócio (Kauan, 06/10/2026): mesma situação do Pedro. Acesso de gerente, fora do rodízio, recebe o que
-- for passado a ele e o cliente que pedir por ele pelo nome. Entra com o nome, não com o apelido.
insert into pa_vendedores (loja_id, nome, usuario, ativo, ordem, no_rodizio, gerente, admin)
select l.id, 'Marcos', 'marcosppautomoveis', true, 8, false, true, false from pa_lojas l
where l.slug = 'pp-automoveis' and not exists (select 1 from pa_vendedores where usuario = 'marcosppautomoveis');
