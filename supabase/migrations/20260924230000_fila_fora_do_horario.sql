-- Fila fora do horário: o robô atende e faz a triagem a qualquer hora, mas o vendedor só é avisado
-- com a loja aberta. A cada 5 minutos o cron chama a função, que despacha a fila das lojas abertas.
-- A URL da função e o segredo do cron ficam no Vault, criados pela migração de cada projeto. O segredo
-- é gerado dentro do banco e a função confere por pa_confere_cron: o valor nunca passa pelo git.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create or replace function pa_confere_cron(segredo text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from vault.decrypted_secrets where name = 'pa_cron_secret' and decrypted_secret = segredo);
$$;
revoke execute on function pa_confere_cron(text) from public, anon, authenticated;
grant execute on function pa_confere_cron(text) to service_role;

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
