-- Contatos que o time já atende pelo aplicativo (23/10/2026, véspera de ligar a Bia para todos): toda mensagem que o time
-- manda pelo WhatsApp Business chega como eco, e o número de quem recebeu fica aqui. Cliente que o time respondeu nos
-- últimos 30 dias e volta a escrever não recebe a apresentação da Bia: a conversa já é de alguém do time.
create table if not exists pa_contatos_do_time (
  loja_id uuid not null references pa_lojas(id) on delete cascade,
  wa text not null,
  ultima_em timestamptz not null default now(),
  primary key (loja_id, wa)
);
alter table pa_contatos_do_time enable row level security;
