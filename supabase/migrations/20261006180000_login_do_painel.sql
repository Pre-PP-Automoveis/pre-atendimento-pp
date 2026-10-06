-- Painel de leads com usuário e senha no lugar do link pessoal (Kauan, 06/10/2026).
-- Usuário: primeiro nome + sufixo da loja ("ryanppautomoveis"). Senha padrão diferente para cada pessoa, que ela
-- pode trocar; o gerente gera uma nova para quem esquecer. Só o hash da senha e o da sessão ficam no banco.
alter table pa_lojas add column if not exists sufixo_usuario text;
update pa_lojas set sufixo_usuario = 'ppautomoveis' where slug = 'pp-automoveis';

alter table pa_vendedores add column if not exists usuario text unique;
alter table pa_vendedores add column if not exists senha_hash text;
alter table pa_vendedores add column if not exists falhas_login int not null default 0;
alter table pa_vendedores add column if not exists bloqueado_ate timestamptz;
update pa_vendedores v set usuario = lower(split_part(trim(v.nome), ' ', 1)) || l.sufixo_usuario
from pa_lojas l where l.id = v.loja_id and l.sufixo_usuario is not null and v.usuario is null;

-- o link pessoal deixa de abrir o painel
alter table pa_vendedores drop column if exists token_painel;

create table if not exists pa_sessoes (
  token_hash text primary key,                 -- SHA-256 do token que fica no aparelho
  vendedor_id uuid not null references pa_vendedores(id) on delete cascade,
  criado_em timestamptz not null default now(),
  expira_em timestamptz not null
);
create index if not exists pa_sessoes_vendedor on pa_sessoes (vendedor_id);
alter table pa_sessoes enable row level security;
