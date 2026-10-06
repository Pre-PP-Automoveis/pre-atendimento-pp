-- Senha padrão vale só para o primeiro acesso: quem entra com ela troca antes de ver o painel (Kauan, 06/10/2026).
alter table pa_vendedores add column if not exists trocar_senha boolean not null default true;
update pa_vendedores set trocar_senha = true;  -- ninguém entrou ainda: todos estão com a senha padrão

-- Pedro é o dono: entra com todos os acessos do gerente, e continua fora do rodízio
update pa_vendedores v set gerente = true from pa_lojas l
where l.id = v.loja_id and l.slug = 'pp-automoveis' and v.nome = 'Pedro';
