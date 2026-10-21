-- Modo de teste (21/10/2026): com o número já ligado e clientes de verdade escrevendo, a Bia só pode responder a quem
-- está na lista de teste. numeros_teste preenchido e ativo = false: a Bia atende só esses números (só dígitos, com 55);
-- todo o resto segue com o time no aplicativo, como antes. Para ligar de vez: ativo = true e numeros_teste = null.
alter table pa_lojas add column if not exists numeros_teste text[];
