-- Fotos dos carros e link da página de fotos (23/11/2026).
-- pa_veiculos.fotos: endereços públicos das fotos no CDN do BNDV, gravados pela rotina das 9h.
-- pa_lojas.link_fotos: começo do link da página de fotos; a Bia manda o link + o código do carro no BNDV,
-- que não muda quando o estoque é trocado (o id da linha muda todo dia).
alter table pa_veiculos add column if not exists fotos text[] not null default '{}';
alter table pa_lojas add column if not exists link_fotos text;
update pa_lojas set link_fotos = 'https://pp-painel-leads.vercel.app/carro?c=' where slug = 'pp-automoveis';
