-- A Meta não libera a coexistência para o app próprio da PP (só para provedor aprovado). Decisão do Kauan (15/10/2026):
-- a Bia ganha um número só dela, ligado direto no app da PP, e o time continua no WhatsApp Business do (11) 96606-3690.
-- numero_atendimento: por onde o consultor fala com o cliente. Preenchido, a Bia diz que o consultor chama por lá,
-- e o consultor marca "Já chamei" no painel (o sistema não vê a resposta dele, que sai de outro número).
alter table pa_lojas add column if not exists numero_atendimento text;
update pa_lojas set numero_atendimento = '(11) 96606-3690' where slug = 'pp-automoveis';
