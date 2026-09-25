-- Pré-atendimento com IA no WhatsApp (produto de tecnologia da Moza).
-- Molde multi-loja: a primeira é a Pedro Paulo Automóveis, as próximas entram como linha em pa_lojas.
-- Só a Edge Function `pre-atendimento` escreve aqui, com a service role. RLS ligado e sem política
-- pública: a leitura pelo painel entra junto com a tela, com a mesma allowlist do dashboard.

create table if not exists pa_lojas (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  nome text not null,                         -- nome comercial, é o que o robô fala
  phone_number_id text unique,                -- id do número na WhatsApp Cloud API
  modelo text not null default 'claude-sonnet-5',
  voz text not null default '',               -- jeito de falar da loja, tirado das conversas reais
  endereco text not null default '',
  -- {"seg":["08:00","18:00"], ..., "dom":null}; dia ausente ou null é loja fechada
  horario jsonb not null default '{}'::jsonb,
  -- aviso do item 8.5 do contrato, anexado em texto fixo à primeira resposta de cada atendimento
  aviso_inicial text not null default '',
  template_aviso_vendedor text,               -- modelo aprovado na Meta para avisar o vendedor da vez
  contato_contingencia text,                  -- WhatsApp que recebe o aviso de sistema fora do ar (4.6)
  ativo boolean not null default false,
  criado_em timestamptz not null default now()
);

create table if not exists pa_vendedores (
  id uuid primary key default gen_random_uuid(),
  loja_id uuid not null references pa_lojas(id) on delete cascade,
  nome text not null,
  whatsapp text not null,                     -- só dígitos, com DDI: 5511987654321
  ativo boolean not null default true,
  ordem int not null default 0,
  ultimo_lead_em timestamptz,                 -- rodízio sequencial: recebe quem está há mais tempo sem lead
  unique (loja_id, whatsapp)
);

-- Ficha do veículo (item 3.8 do contrato). O robô reproduz sem alterar (2.4) e não responde o que não estiver aqui.
create table if not exists pa_veiculos (
  id uuid primary key default gen_random_uuid(),
  loja_id uuid not null references pa_lojas(id) on delete cascade,
  titulo text not null,                       -- "Volkswagen Up! Take 1.0 2014/2015"
  disponivel boolean not null default true,
  preco numeric,
  km int,
  leilao text,                                -- texto da loja, reproduzido como está
  laudo_cautelar text,
  unico_dono text,
  observacoes text,
  anuncios jsonb not null default '{}'::jsonb, -- {"WebMotors":"73702794","Mercado Livre":"MLB5123456789"}
  atualizado_em timestamptz not null default now()
);
create index if not exists pa_veiculos_loja on pa_veiculos (loja_id);

create table if not exists pa_conversas (
  id uuid primary key default gen_random_uuid(),
  loja_id uuid not null references pa_lojas(id) on delete cascade,
  lead_wa text not null,
  lead_nome text,
  -- fila: triagem terminou com a loja fechada; o vendedor da vez recebe o aviso quando a loja abrir
  estado text not null default 'robo' check (estado in ('robo', 'fila', 'encaminhada', 'encerrada')),
  -- lista fechada de metodologia/comercial-lojas-de-veiculos.md
  origem text not null default 'Não identificado' check (origem in (
    'WebMotors', 'Mercado Livre', 'Tráfego Pago', 'Mobi Auto', 'Na Pista', 'OLX',
    'Clientes de Porta', 'Não identificado')),
  origem_detalhe jsonb not null default '{}'::jsonb,
  veiculo_id uuid references pa_veiculos(id) on delete set null,
  vendedor_id uuid references pa_vendedores(id) on delete set null,
  resumo jsonb,
  iniciada_em timestamptz not null default now(),
  -- os dois carimbos da instalação 2 do método: só o segundo entra no indicador de SLA
  respondido_robo_em timestamptz,
  fila_em timestamptz,
  encaminhado_em timestamptz,                 -- quando o vendedor foi avisado (na abertura, se veio da fila)
  primeira_acao_humana_em timestamptz,
  ultima_msg_em timestamptz not null default now()
);
-- um atendimento aberto por lead e por loja
create unique index if not exists pa_conversas_aberta
  on pa_conversas (loja_id, lead_wa) where estado <> 'encerrada';

create table if not exists pa_mensagens (
  id bigserial primary key,
  conversa_id uuid not null references pa_conversas(id) on delete cascade,
  autor text not null check (autor in ('lead', 'robo', 'sistema')),
  tipo text not null default 'text',
  texto text not null default '',
  wa_id text unique,                          -- id da Meta: a mesma mensagem reentregue não duplica
  custo_usd numeric,
  criado_em timestamptz not null default now()
);
create index if not exists pa_mensagens_conversa on pa_mensagens (conversa_id, criado_em);

-- volume do item 6.4: conversa é telefone distinto no mês, contado uma vez
-- security_invoker: sem ele a view roda como dona e expõe as conversas pela API pública, passando por cima do RLS
create or replace view pa_volume_mensal with (security_invoker = true) as
select loja_id,
       date_trunc('month', iniciada_em at time zone 'America/Sao_Paulo')::date as mes,
       count(distinct lead_wa) as conversas
from pa_conversas
group by 1, 2;

alter table pa_lojas enable row level security;
alter table pa_vendedores enable row level security;
alter table pa_veiculos enable row level security;
alter table pa_conversas enable row level security;
alter table pa_mensagens enable row level security;
