-- Horário novo da loja (Kauan, 07/11/2026): segunda a sábado, das 9h às 18h30. Domingo segue fechado.
update pa_lojas set horario = '{"dom": null, "seg": ["09:00", "18:30"], "ter": ["09:00", "18:30"], "qua": ["09:00", "18:30"], "qui": ["09:00", "18:30"], "sex": ["09:00", "18:30"], "sab": ["09:00", "18:30"]}'::jsonb
where slug = 'pp-automoveis';

-- Brendon sai dos consultores ativos (Kauan, 07/11/2026): sai do rodízio e do painel. O celular dele continua
-- reconhecido como do time, então a Bia não responde se ele escrever para a loja.
update pa_vendedores v set ativo = false, no_rodizio = false
from pa_lojas l where l.id = v.loja_id and l.slug = 'pp-automoveis' and v.usuario = 'brendonppautomoveis';
delete from pa_sessoes where vendedor_id in (select id from pa_vendedores where usuario = 'brendonppautomoveis');

-- Aviso de lead novo no celular (Web Push): um registro por aparelho que ligou o aviso no painel.
create table if not exists pa_push (
  endpoint text primary key,
  vendedor_id uuid not null references pa_vendedores(id) on delete cascade,
  inscricao jsonb not null,
  criado_em timestamptz not null default now()
);
alter table pa_push enable row level security;
