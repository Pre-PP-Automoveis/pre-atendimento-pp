-- A troca de carro ainda financiado não estava na lista do Leo (06/10/2026): o robô não afirma, diz que o consultor confirma.
update pa_lojas set fatos = fatos || E'\n- Carro da troca ainda financiado: o robô não confirma se entra. Quem vê isso é o consultor.'
where slug = 'pp-automoveis' and fatos not like '%ainda financiado%';
