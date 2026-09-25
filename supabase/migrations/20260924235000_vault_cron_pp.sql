-- Vault do projeto da PP (qdzuwnqejtjbtcysteip): endereço da função e segredo do cron.
-- O segredo nasce aleatório aqui dentro e não sai do banco.
select vault.create_secret('https://qdzuwnqejtjbtcysteip.supabase.co/functions/v1/pre-atendimento', 'pa_url_funcao');
select vault.create_secret(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'pa_cron_secret');
