# Pré-atendimento PP

Robô de pré-atendimento no WhatsApp da Pedro Paulo Automóveis, produto da Moza.
Supabase próprio: projeto `qdzuwnqejtjbtcysteip`. Desenho e contrato no cérebro, em `clientes/pp-automoveis/`.

As tabelas aceitam mais de uma loja (`pa_lojas`), mas este repositório e este projeto atendem só a PP.

## Como funciona

O número da loja é **compartilhado**: os vendedores atendem pelo WhatsApp Business, e o robô usa o mesmo número
pela API (coexistência da Meta). Ninguém precisa trocar de aplicativo.

1. O lead escreve no número da loja (portal, anúncio do Meta ou contato direto). O robô nunca inicia conversa.
2. A origem sai sozinha: `referral` do anúncio do Meta ou o link do portal na mensagem pronta (`origem.ts`).
   O id do anúncio amarra a conversa à ficha do veículo em `pa_veiculos`.
3. A função espera 5 segundos para o lead terminar de digitar e responde uma vez só.
4. A Claude responde com a ficha, faz as três perguntas (troca, pagamento, prazo) e chama `encaminhar_ao_vendedor`.
5. O vendedor da vez (rodízio sequencial, `rodizio.ts`) recebe no WhatsApp pessoal o modelo aprovado com o resumo
   e o telefone do lead, e responde pelo aplicativo da loja, na mesma conversa.
6. **Quando qualquer pessoa do time escreve ao lead pelo aplicativo**, a Meta manda o eco (`smb_message_echoes`):
   o robô sai da conversa e o eco vira o carimbo `primeira_acao_humana_em`. Vale também se o time entrar antes
   do robô encaminhar.
7. **No máximo 15 minutos com o robô** (`pa_lojas.prazo_robo_min`): se a triagem não terminar nesse tempo (o lead
   parou de responder, ou a conversa se alongou), o cron passa a conversa ao consultor da vez com o que tiver.
8. **Repasse, como no BNDV:** se ninguém escrever ao lead em `pa_lojas.prazo_repasse_min` (15 minutos), o cron
   avisa o próximo do rodízio. Quando todos já foram avisados, avisa o gerente (`gerente_whatsapp`) uma vez.
   O repasse só corre com a loja aberta.

**Fora do horário** o robô atende igual: responde, tira dúvida com a ficha e faz a triagem inteira. No encaminhamento,
em vez de avisar o vendedor, o atendimento entra na `fila` e o lead ouve que um vendedor o atende quando a loja abrir,
com dia e hora ("amanhã às 08:00"). A cada minuto o `pg_cron` chama a função, que avisa os vendedores da fila das
lojas que já abriram, pelo mesmo rodízio. O `encaminhado_em` marca esse aviso, então o SLA conta do horário comercial.

A primeira resposta de cada atendimento leva o aviso do item 8.5 do contrato em texto fixo (`pa_lojas.aviso_inicial`,
com um padrão no código). Se a Claude falhar, o lead recebe uma resposta de contingência e o lead vai direto
ao vendedor (item 4.6).

## Acesso ao Supabase

Os comandos passam por `scripts/supabase.sh`, que usa um token da conta dona do projeto guardado fora do git
(`~/.config/<nome do repositório>/supabase-token`). O login global do Supabase na máquina não muda. Sem o token,
o script mostra onde gerar e o comando para gravar sem o valor aparecer na tela.

## Segredos

```bash
scripts/supabase.sh secrets set WHATSAPP_TOKEN=...            # usuário do sistema do Business Manager da Moza
scripts/supabase.sh secrets set WHATSAPP_APP_SECRET=...       # app da Meta, para validar a assinatura do webhook
scripts/supabase.sh secrets set WHATSAPP_VERIFY_TOKEN=...     # texto qualquer, repetido no painel da Meta
scripts/supabase.sh secrets set ANTHROPIC_API_KEY=...         # projeto novo: a chave da prospecção não vem junto
# WHATSAPP_GRAPH_VERSION é opcional, padrão v23.0
```

## Subir

```bash
scripts/supabase.sh link --project-ref qdzuwnqejtjbtcysteip   # uma vez por máquina
scripts/supabase.sh db push                                    # tabelas pa_* e a loja PP, inativa
scripts/supabase.sh functions deploy pre-atendimento           # verify_jwt = false já está no config.toml
```

O segredo do cron não é configurado à mão: a migração `20260924235000_vault_cron_pp.sql` gera um valor aleatório
no Vault e grava o endereço da função. O cron manda o segredo no cabeçalho e a função confere com `pa_confere_cron`.

URL do webhook para o painel da Meta: `https://qdzuwnqejtjbtcysteip.supabase.co/functions/v1/pre-atendimento`,
assinando os campos **`messages`** e **`smb_message_echoes`**. Sem o segundo, o robô não percebe o vendedor e fala por cima.

A coexistência (número no WhatsApp Business e na API ao mesmo tempo) só é ligada pelo cadastro incorporado
(Embedded Signup) de um Tech Provider ou parceiro oficial da Meta. O número precisa de 7 dias de uso no aplicativo
antes, e o aplicativo precisa ser aberto pelo menos a cada 14 dias.

## Modelo de aviso ao vendedor (enviar para aprovação na Meta)

Categoria **Utilidade**, idioma **pt_BR**, nome sugerido `novo_lead_pre_atendimento`, sem botão:

> Lead para você: {{1}}, {{2}}. Carro: {{3}}. Origem: {{4}}. {{5}} Responda pelo WhatsApp da loja.

O mesmo modelo avisa o gerente quando o rodízio acaba sem resposta. Cada aviso é uma mensagem de utilidade iniciada
pela empresa e tem tarifa da Meta. Pelo item 2.5, IV do contrato essa tarifa é da loja, não da Moza.

## Cadastro da loja

A migração `20260924220000_loja_pp.sql` cria a PP inativa, com endereço e horário de funcionamento
(segunda a sexta, 8h às 18h; sábado, 8h às 17h; domingo fechado). Para ligar:

```sql
update pa_lojas set phone_number_id = '[DEFINIR: id do número novo na Cloud API]',
  gerente_nome = '[DEFINIR]', gerente_whatsapp = '55119...', ativo = true
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

- Tela no painel da Moza lendo `pa_conversas` e `pa_volume_mensal`.
- Registro automático no BNDV, que não tem API pública (item 3.5).
- Transcrição de áudio.
