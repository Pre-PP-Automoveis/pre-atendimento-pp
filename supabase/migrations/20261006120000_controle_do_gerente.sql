-- Controle do gerente no painel de leads, e lead que pede alguém do time pelo nome.
-- O gerente é um consultor com gerente = true: o link pessoal dele abre a visão da loja, com os leads dele no topo.
-- No painel ele puxa um lead para si ou passa para outra pessoa, tira e põe gente no rodízio e marca o que não é lead.
alter table pa_vendedores add column if not exists gerente boolean not null default false;
-- no_rodizio: recebe lead automático. Fora do rodízio a pessoa continua com o link e recebe o que for passado ou pedido.
alter table pa_vendedores add column if not exists no_rodizio boolean not null default true;
alter table pa_lojas drop column if exists token_painel_gerente;  -- o link do gerente agora é o pessoal dele

-- lead com dono fixo: o cliente pediu a pessoa pelo nome ('lead') ou o gerente passou ('gerente'). Não repassa sozinho.
alter table pa_conversas add column if not exists fixado_por text check (fixado_por in ('lead', 'gerente'));
-- passado pelo gerente: volta para a vez do novo dono até alguém escrever ao lead de novo
alter table pa_conversas add column if not exists transferido_em timestamptz;
alter table pa_conversas add column if not exists ultima_acao_humana_em timestamptz;
update pa_conversas set ultima_acao_humana_em = primeira_acao_humana_em where ultima_acao_humana_em is null;

-- contatos que o gerente marcou como "não é lead" (banco, despachante, fornecedor): o robô não responde mais
create table if not exists pa_ignorados (
  loja_id uuid not null references pa_lojas(id) on delete cascade,
  wa text not null,
  motivo text,
  criado_em timestamptz not null default now(),
  primary key (loja_id, wa)
);
alter table pa_ignorados enable row level security;
