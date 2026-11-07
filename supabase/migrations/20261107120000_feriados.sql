-- Feriado: a loja não abre (Kauan, 07/11/2026). O código já conhece os feriados nacionais; calendario diz também o estado
-- e a cidade ('br', 'br-sp', 'br-sp-santo-andre'). dias_fechados e dias_abertos são as exceções da loja: fechar num ponto
-- facultativo (Carnaval, Corpus Christi) ou abrir num feriado.
alter table pa_lojas add column if not exists calendario text not null default 'br';
alter table pa_lojas add column if not exists dias_fechados date[] not null default '{}';
alter table pa_lojas add column if not exists dias_abertos date[] not null default '{}';
update pa_lojas set calendario = 'br-sp-santo-andre' where slug = 'pp-automoveis';
