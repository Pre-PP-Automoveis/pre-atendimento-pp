-- O app da Moza foi aprovado pela Meta (17/10/2026): volta o plano original, um número só. O (11) 96606-3690 fica no
-- WhatsApp Business do time e, pela coexistência, também na API da Bia. A Bia volta a dizer que o consultor continua
-- "aqui mesmo", e o "Já chamei" some do painel (o eco do aplicativo tira a Bia da conversa sozinho).
update pa_lojas set numero_atendimento = null where slug = 'pp-automoveis';

-- loja fictícia criada para o revisor da Meta testar o cadastro incorporado: a análise acabou
delete from pa_lojas where slug = 'revisao-meta' and ativo = false and phone_number_id is null;
