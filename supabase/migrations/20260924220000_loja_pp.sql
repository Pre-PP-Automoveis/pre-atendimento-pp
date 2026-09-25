-- Pedro Paulo Automóveis (PP GARAGE 37 COMÉRCIO DE VEÍCULOS LTDA, CNPJ 59.464.163/0001-78).
-- Nasce inativa: liga quando o número novo estiver na Cloud API e o modelo de aviso aprovado na Meta.
--   update pa_lojas set phone_number_id = '<id>', ativo = true where slug = 'pp-automoveis';
-- Horário de funcionamento informado pelo Kauan em 24/09/2026. Não confundir com a janela de
-- redistribuição do BNDV (8h às 23h), que é regra de rodízio e não horário da loja.
insert into pa_lojas (slug, nome, endereco, modelo, horario, template_aviso_vendedor, ativo)
values (
  'pp-automoveis',
  'Pedro Paulo Automóveis',
  'Rua Juquiá, 275, Paraíso, Santo André',
  'claude-sonnet-5',
  '{"seg":["08:00","18:00"],"ter":["08:00","18:00"],"qua":["08:00","18:00"],"qui":["08:00","18:00"],"sex":["08:00","18:00"],"sab":["08:00","17:00"],"dom":null}'::jsonb,
  'novo_lead_pre_atendimento',
  false
)
on conflict (slug) do update set horario = excluded.horario, endereco = excluded.endereco;
