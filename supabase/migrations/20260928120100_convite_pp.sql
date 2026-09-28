-- Convite de cadastro da Pedro Paulo, gerado aleatório no banco. Lido pela chave de serviço para montar o link.
update pa_lojas
set convite_onboarding = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
where slug = 'pp-automoveis' and convite_onboarding is null and ligada_em is null;
