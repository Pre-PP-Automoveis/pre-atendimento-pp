// Feriados em que a loja não abre (Kauan, 07/11/2026: "no feriado a loja não abre"). Em 02/11 o sistema tratou Finados
// como dia comum: a Bia prometeu consultor "em instantes" e o rodízio girou com a loja fechada.
// Só feriado de lei. Ponto facultativo (Carnaval, Corpus Christi, vésperas de Natal e Ano-Novo) a loja abre; se fechar
// num desses, ou abrir num feriado, vale o que estiver em pa_lojas.dias_fechados e pa_lojas.dias_abertos.
// Fontes: Lei 662/1949 e Lei 14.759/2023 (nacionais, conferidos na Portaria MGI 11.460/2025, 10 feriados em 2026),
// Lei estadual 9.497/1997 (9 de julho em SP) e Lei municipal 2.634/1967 (8 de abril, aniversário de Santo André).

const NACIONAIS: Record<string, string> = {
  "01-01": "Confraternização Universal", "04-21": "Tiradentes", "05-01": "Dia do Trabalho",
  "09-07": "Independência", "10-12": "Nossa Senhora Aparecida", "11-02": "Finados",
  "11-15": "Proclamação da República", "11-20": "Consciência Negra", "12-25": "Natal",
};
const ESTADUAIS: Record<string, Record<string, string>> = { sp: { "07-09": "Revolução Constitucionalista" } };
const MUNICIPAIS: Record<string, Record<string, string>> = { "santo-andre": { "04-08": "aniversário de Santo André" } };

/* domingo de Páscoa (algoritmo de Meeus/Jones/Butcher, calendário gregoriano) */
function pascoa(ano: number) {
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(ano, mes - 1, dia));
}

/* "br", "br-sp" ou "br-sp-santo-andre": país, estado e cidade da loja */
export function feriadoEm(iso: string, calendario = "br"): string | null {
  const [ano, mes, dia] = iso.split("-");
  const md = `${mes}-${dia}`;
  if (NACIONAIS[md]) return NACIONAIS[md];
  const sexta = pascoa(Number(ano)); sexta.setUTCDate(sexta.getUTCDate() - 2);
  if (sexta.toISOString().slice(0, 10) === iso) return "Sexta-feira Santa";
  const [, uf, ...cidade] = calendario.split("-");
  if (uf && ESTADUAIS[uf]?.[md]) return ESTADUAIS[uf][md];
  const municipio = cidade.join("-");
  if (municipio && MUNICIPAIS[municipio]?.[md]) return MUNICIPAIS[municipio][md];
  return null;
}

export type Calendario = { calendario?: string | null; dias_fechados?: string[] | null; dias_abertos?: string[] | null };

/* motivo de a loja não abrir nesse dia, ou null se o dia segue o horário normal */
export function fechadoNoDia(iso: string, cal: Calendario = {}): string | null {
  if (cal.dias_abertos?.includes(iso)) return null;
  if (cal.dias_fechados?.includes(iso)) return "a loja não abre";
  return feriadoEm(iso, cal.calendario ?? "br");
}
