# Pré-atendimento PP

Robô de pré-atendimento no WhatsApp da Pedro Paulo Automóveis, produto da Moza.
Supabase próprio: projeto `qdzuwnqejtjbtcysteip`. Desenho e contrato no cérebro, em `clientes/pp-automoveis/`.

As tabelas aceitam mais de uma loja (`pa_lojas`), mas este repositório e este projeto atendem só a PP.

## Como funciona

1. O lead escreve no número da loja (portal, anúncio do Meta ou contato direto). O robô nunca inicia conversa.
2. A origem sai sozinha: `referral` do anúncio do Meta ou o link do portal na mensagem pronta (`origem.ts`).
   O id do anúncio amarra a conversa à ficha do veículo em `pa_veiculos`.
3. A função espera 5 segundos para o lead terminar de digitar e responde uma vez só.
4. A Claude responde com a ficha, faz as três perguntas (troca, pagamento, prazo) e chama `encaminhar_ao_vendedor`.
5. O vendedor da vez (rodízio sequencial) recebe o modelo aprovado com o resumo e o `wa.me` do lead.
   Ele toca em **Assumi**, e esse toque é o carimbo `primeira_acao_humana_em`.
6. Se o lead voltar a escrever no número da loja, o robô lembra quem está com o atendimento.

A primeira resposta de cada atendimento leva o aviso do item 8.5 do contrato em texto fixo (`pa_lojas.aviso_inicial`,
com um padrão no código). Se a Claude falhar, o lead recebe uma resposta de contingência e o lead vai direto
ao vendedor (item 4.6).

## Segredos

```bash
supabase secrets set WHATSAPP_TOKEN=...            # usuário do sistema do Business Manager da Moza
supabase secrets set WHATSAPP_APP_SECRET=...       # app da Meta, para validar a assinatura do webhook
supabase secrets set WHATSAPP_VERIFY_TOKEN=...     # texto qualquer, repetido no painel da Meta
supabase secrets set ANTHROPIC_API_KEY=...         # projeto novo: a chave da prospecção não vem junto
# WHATSAPP_GRAPH_VERSION é opcional, padrão v23.0
```

## Subir

```bash
supabase link --project-ref qdzuwnqejtjbtcysteip   # uma vez por máquina
supabase db push                                    # tabelas pa_* e a loja PP, inativa
supabase functions deploy pre-atendimento           # verify_jwt = false já está no config.toml
```

URL do webhook para o painel da Meta: `https://qdzuwnqejtjbtcysteip.supabase.co/functions/v1/pre-atendimento`,
assinando o campo `messages`.

## Modelo de aviso ao vendedor (enviar para aprovação na Meta)

Categoria **Utilidade**, idioma **pt_BR**, nome sugerido `novo_lead_pre_atendimento`:

> Novo lead do pré-atendimento: {{1}}, wa.me/{{2}}. Carro: {{3}}. Origem: {{4}}. {{5}}

Botão de resposta rápida: **Assumi**.

Cada aviso é uma mensagem de utilidade iniciada pela empresa e tem tarifa da Meta. Pelo item 2.5, IV do contrato
essa tarifa é da loja, não da Moza.

## Cadastro da loja

A migração `20260924220000_loja_pp.sql` cria a PP inativa, com endereço e horário de funcionamento
(segunda a sexta, 8h às 18h; sábado, 8h às 17h; domingo fechado). Para ligar:

```sql
update pa_lojas set phone_number_id = '[DEFINIR: id do número novo na Cloud API]', ativo = true
where slug = 'pp-automoveis';

insert into pa_vendedores (loja_id, nome, whatsapp, ordem)
select id, v.nome, v.wa, v.ordem from pa_lojas, (values
  ('[DEFINIR]', '55119...', 1)
) as v(nome, wa, ordem) where slug = 'pp-automoveis';
```

A voz da loja (`pa_lojas.voz`) sai das conversas reais do time. Sem as fichas em `pa_veiculos`, o robô só faz triagem
e manda para o vendedor toda pergunta sobre o carro, conforme o item 3.8 do contrato.

O modelo começa em Sonnet 5 enquanto o prompt é calibrado e desce para Haiku 4.5 quando o roteiro estabilizar.
A troca é o campo `pa_lojas.modelo`.

## Testes

```bash
deno task test
deno task check
```

## Fora da fase 1

- Escalonamento para o gerente quando ninguém toca em Assumi no prazo (precisa de agendamento com pg_cron).
- Tela no painel da Moza lendo `pa_conversas` e `pa_volume_mensal`.
- Registro automático no BNDV, que não tem API pública (item 3.5).
- Transcrição de áudio.
