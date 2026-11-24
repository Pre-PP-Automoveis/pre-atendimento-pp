-- Fotos do carro como imagem na conversa (24/11/2026, Kauan): nenhum link sai para o cliente, nem do BNDV nem nosso.
-- A rotina das 9h converte as fotos do BNDV (quase todas .webp, que o WhatsApp não aceita como imagem) para JPEG e guarda
-- neste armazenamento privado; pa_veiculos.fotos passa a ter o caminho de cada foto aqui dentro. A função envia cada foto
-- ao WhatsApp por um endereço assinado de poucos minutos, que só a Meta usa para buscar a imagem.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos-veiculos', 'fotos-veiculos', false, 5242880, array['image/jpeg'])
on conflict (id) do nothing;

-- o que foi anexado à mensagem (as fotos que a Bia mandou: carro e quais já foram, para "manda mais" seguir de onde parou)
alter table pa_mensagens add column if not exists anexo jsonb;

-- a página pública de fotos saiu: nenhuma loja tem mais link de fotos
update pa_lojas set link_fotos = null;
