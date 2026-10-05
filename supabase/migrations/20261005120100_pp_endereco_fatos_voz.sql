-- Pedro Paulo: endereço confirmado pelo Kauan em 05/10/2026 e condições tiradas das conversas reais do time.
update pa_lojas set
  endereco = 'Rua Juquiá, 275, Paraíso, Santo André, SP, CEP 09190-675',
  fatos = E'- Financiamento em até 60x com os principais bancos. Aprovação, entrada e parcela dependem da análise de crédito, feita pelo consultor.\n- Entrada ou valor do carro parcelado no cartão de crédito em até 24x.\n- A loja aceita carro na troca, inclusive carro ainda financiado. A avaliação é feita pelo consultor.',
  voz = E'O time trata o cliente por "você", escreve curto e responde rápido. Frases do time que servem de modelo: "Tenho sim, ainda está disponível." "Aceitamos troca sim. Qual é o seu carro e quantos km ele tem?" "Você pensa em financiar, dar um carro na troca ou pagar à vista?" "Quer passar na loja para ver o carro de perto?" Quando o cliente quer vir, o time manda o endereço por escrito e o consultor confirma o horário.'
where slug = 'pp-automoveis';
