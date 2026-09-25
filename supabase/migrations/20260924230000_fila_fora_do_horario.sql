-- Fila fora do horário: o robô atende e faz a triagem a qualquer hora, mas o vendedor só é avisado
-- com a loja aberta. A cada 5 minutos o cron chama a função, que despacha a fila das lojas abertas.
-- A URL da função e o segredo ficam no Vault, nunca no git:
--   select vault.create_secret('https://<ref>.supabase.co/functions/v1/pre-atendimento', 'pa_url_funcao');
--   select vault.create_secret('<mesmo valor do segredo PA_CRON_SECRET da função>', 'pa_cron_secret');
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create index if not exists pa_conversas_fila on pa_conversas (loja_id, fila_em) where estado = 'fila';

select cron.schedule(
  'pa-despachar-fila',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'pa_url_funcao'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'pa_cron_secret')),
    body := '{"acao":"despachar_fila"}'::jsonb
  );
  $$
);
