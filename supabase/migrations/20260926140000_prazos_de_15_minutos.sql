-- Decisão do Kauan em 26/09/2026: no máximo 15 minutos.
-- prazo_robo_min: tempo máximo do lead com o robô; passou, vai para o consultor da vez com a triagem que tiver.
-- prazo_repasse_min: tempo do consultor da vez sem responder antes de o lead ir para o próximo.
alter table pa_lojas add column if not exists prazo_robo_min int not null default 15;
alter table pa_lojas alter column prazo_repasse_min set default 15;
update pa_lojas set prazo_repasse_min = 15, prazo_robo_min = 15 where slug = 'pp-automoveis';
