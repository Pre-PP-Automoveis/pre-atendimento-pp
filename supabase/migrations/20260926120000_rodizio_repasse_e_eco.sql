-- Número compartilhado e rodízio com repasse, no desenho do BNDV.
-- O time atende pelo WhatsApp Business no mesmo número do robô (coexistência da Meta). Quando alguém escreve ao
-- lead pelo aplicativo, a Meta manda o eco: o robô sai da conversa e isso vira a primeira ação humana.
-- Se ninguém escrever no prazo, o lead passa para o próximo vendedor; acabado o rodízio, avisa o gerente.

alter table pa_mensagens drop constraint if exists pa_mensagens_autor_check;
alter table pa_mensagens add constraint pa_mensagens_autor_check
  check (autor in ('lead', 'robo', 'vendedor', 'sistema'));

alter table pa_conversas add column if not exists avisado_em timestamptz;             -- último aviso ao vendedor da vez
alter table pa_conversas add column if not exists tentativas uuid[] not null default '{}'; -- vendedores já avisados neste lead
alter table pa_conversas add column if not exists escalado_em timestamptz;            -- aviso ao gerente, uma vez

-- prazo sem resposta antes de repassar; 60 é o que o BNDV usa hoje
alter table pa_lojas add column if not exists prazo_repasse_min int not null default 60;
alter table pa_lojas add column if not exists gerente_nome text;
alter table pa_lojas add column if not exists gerente_whatsapp text;

create index if not exists pa_conversas_repasse on pa_conversas (loja_id, avisado_em)
  where estado = 'encaminhada' and primeira_acao_humana_em is null;

-- o cron passa a rodar a cada minuto: o prazo de repasse precisa de mais precisão que 5 minutos
select cron.schedule(
  'pa-despachar-fila',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'pa_url_funcao'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'pa_cron_secret')),
    body := '{"acao":"cron"}'::jsonb
  );
  $$
);
