-- Acesso de administrador da Moza (Kauan, 06/10/2026): vê tudo o que o gerente vê, mais a saúde do sistema, os erros,
-- os números e custos e a conversa inteira de cada lead. É invisível para o time: fora do rodízio, fora da lista de
-- "passar para", o robô não reconhece o nome e o gerente não mexe na senha dele.
alter table pa_vendedores add column if not exists admin boolean not null default false;

-- erros que antes iam só para o log da função: agora ficam no banco, agrupados (o mesmo erro repetido soma "vezes")
create table if not exists pa_erros (
  chave text primary key,                      -- onde | conversa | mensagem
  loja_id uuid references pa_lojas(id) on delete cascade,
  onde text not null,
  conversa_id uuid references pa_conversas(id) on delete set null,
  mensagem text not null,
  vezes int not null default 1,
  primeiro_em timestamptz not null default now(),
  ultimo_em timestamptz not null default now()
);
create index if not exists pa_erros_ultimo on pa_erros (loja_id, ultimo_em desc);
alter table pa_erros enable row level security;

create or replace function pa_registra_erro(p_loja uuid, p_onde text, p_conversa uuid, p_mensagem text)
returns void language sql security definer set search_path = public as $$
  insert into pa_erros (chave, loja_id, onde, conversa_id, mensagem)
  values (p_onde || '|' || coalesce(p_conversa::text, '-') || '|' || left(p_mensagem, 300), p_loja, p_onde, p_conversa, left(p_mensagem, 2000))
  on conflict (chave) do update set vezes = pa_erros.vezes + 1, ultimo_em = now();
$$;
revoke all on function pa_registra_erro(uuid, text, uuid, text) from public, anon, authenticated;

-- batimento do sistema: quando o cron rodou e quando chegou o último aviso da Meta
create table if not exists pa_saude (
  chave text primary key,
  em timestamptz not null default now(),
  detalhe jsonb
);
alter table pa_saude enable row level security;

-- o admin da PP: Kauan, sem senha até o script criar a padrão (troca obrigatória no primeiro acesso)
insert into pa_vendedores (loja_id, nome, usuario, ativo, ordem, no_rodizio, gerente, admin)
select l.id, 'Kauan', 'kauanadm', true, 100, false, true, true from pa_lojas l
where l.slug = 'pp-automoveis' and not exists (select 1 from pa_vendedores where usuario = 'kauanadm');
