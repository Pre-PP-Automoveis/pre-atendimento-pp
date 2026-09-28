-- Ligação da loja pelo cadastro incorporado da Meta, com a Moza como Tech Provider.
-- A loja abre mozabr.com.br/conectar-whatsapp.html?convite=<convite>, conecta o número que já usa no WhatsApp
-- Business (coexistência) e a função guarda a credencial dela aqui. Nada disso tem leitura pública.

create table if not exists pa_credenciais (
  loja_id uuid primary key references pa_lojas(id) on delete cascade,
  token_whatsapp text not null,               -- credencial de integração da loja, gerada no cadastro
  atualizado_em timestamptz not null default now()
);
alter table pa_credenciais enable row level security;

alter table pa_lojas add column if not exists waba_id text;
alter table pa_lojas add column if not exists numero_exibido text;           -- como a Meta mostra o número
alter table pa_lojas add column if not exists convite_onboarding text unique; -- link de uso único para o cadastro
alter table pa_lojas add column if not exists ligada_em timestamptz;          -- cadastro concluído (a loja só atende com ativo = true)
alter table pa_lojas add column if not exists sincronizada_em timestamptz;    -- contatos e histórico pedidos à Meta (prazo de 24h)
