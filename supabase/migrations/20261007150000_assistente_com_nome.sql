-- A assistente do pré-atendimento ganha nome e abertura de consultoria (Kauan, 07/10/2026). A primeira mensagem continua
-- cumprindo o item 8.5 do contrato (sistema automatizado, uso dos dados, pedir um consultor), numa frase natural.
alter table pa_lojas add column if not exists nome_assistente text;
update pa_lojas set nome_assistente = 'Bia' where slug = 'pp-automoveis' and nome_assistente is null;
