-- Login permanente no painel (Kauan, 07/11/2026). As sessões abertas, inclusive as que venceram em 06/11 (Rayan e Brendon),
-- passam a valer por 10 anos: o aparelho que ainda guarda o acesso volta a entrar sem senha. Quem já viu a tela de entrada
-- depois de 06/11 perdeu o acesso guardado e entra uma vez com a própria senha.
update pa_sessoes s set expira_em = now() + interval '3650 days'
from pa_vendedores v where v.id = s.vendedor_id and v.ativo;
