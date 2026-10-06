-- O nome do consultor é Rayan, não Ryan (Kauan, 06/10/2026). A senha do primeiro acesso continua a mesma.
update pa_vendedores v set nome = 'Rayan', usuario = 'rayanppautomoveis'
from pa_lojas l where l.id = v.loja_id and l.slug = 'pp-automoveis' and v.nome = 'Ryan';
