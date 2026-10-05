-- Painel de leads: com o número compartilhado, o consultor não recebe aviso no WhatsApp pessoal. O rodízio põe o
-- lead na fila dele e o painel (link pessoal) mostra, em ordem, com o tempo até o repasse. O gerente vê tudo.
-- aviso_modo: 'painel' (só o painel) ou 'whatsapp' (painel + modelo aprovado no WhatsApp pessoal do consultor).
alter table pa_lojas add column if not exists aviso_modo text not null default 'painel'
  check (aviso_modo in ('painel', 'whatsapp'));
alter table pa_lojas add column if not exists token_painel_gerente text unique
  default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
update pa_lojas set token_painel_gerente = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
  where token_painel_gerente is null;

alter table pa_vendedores alter column whatsapp drop not null;  -- no modo painel o consultor não precisa de número
alter table pa_vendedores add column if not exists token_painel text unique
  default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
