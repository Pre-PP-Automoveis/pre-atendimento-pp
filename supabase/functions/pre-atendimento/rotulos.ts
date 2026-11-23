// Como áudio e foto do cliente aparecem para a Bia e no painel depois de virar texto (midia.ts). Funções puras, testadas em midia_test.ts.
export const rotuloAudio = (transcricao: string) => `[áudio do cliente: ${transcricao.replace(/\s+/g, " ").trim()}]`;
export const rotuloFoto = (descricao: string, legenda?: string | null) =>
  `[foto do cliente: ${descricao.replace(/\s+/g, " ").trim()}]${legenda?.trim() ? ` legenda: ${legenda.trim()}` : ""}`;
