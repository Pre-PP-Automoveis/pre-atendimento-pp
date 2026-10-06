-- A PP aceita carro ainda financiado na troca (Kauan, 06/10/2026): a loja quita o financiamento e o que sobra entra no outro carro.
update pa_lojas set fatos = replace(fatos,
  '- Carro da troca ainda financiado: o robô não confirma se entra. Quem vê isso é o consultor.',
  '- A loja aceita na troca carro ainda financiado: ela quita o financiamento e o que sobrar do valor do carro entra no pagamento do outro. Quanto o carro vale e quanto falta quitar quem vê é o consultor.')
where slug = 'pp-automoveis';
