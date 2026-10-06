// Acesso ao painel de leads: usuário e senha por pessoa do time, e uma sessão por aparelho.
// A senha só fica guardada como hash PBKDF2 (o mesmo formato que scripts/senhas-painel.sh grava),
// e a sessão só como SHA-256: quem lê o banco não consegue entrar no painel com o que está lá.
const ITERACOES = 100_000;
const enc = new TextEncoder();
const hex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const deHex = (h: string) => new Uint8Array((h.match(/../g) ?? []).map((x) => parseInt(x, 16)));

/* formato guardado: pbkdf2$<iterações>$<sal em hex>$<hash em hex> */
export async function hashSenha(senha: string, sal = hex(crypto.getRandomValues(new Uint8Array(16))), iteracoes = ITERACOES) {
  const chave = await crypto.subtle.importKey("raw", enc.encode(senha), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: deHex(sal), iterations: iteracoes }, chave, 256);
  return `pbkdf2$${iteracoes}$${sal}$${hex(bits)}`;
}

export async function confereSenha(senha: string, guardado: string | null | undefined) {
  const [tipo, iteracoes, sal, esperado] = (guardado ?? "").split("$");
  if (tipo !== "pbkdf2" || !sal || !esperado || !(Number(iteracoes) > 0)) return false;
  const obtido = (await hashSenha(senha, sal, Number(iteracoes))).split("$")[3];
  let dif = obtido.length ^ esperado.length; // comparação em tempo constante
  for (let i = 0; i < Math.min(obtido.length, esperado.length); i++) dif |= obtido.charCodeAt(i) ^ esperado.charCodeAt(i);
  return dif === 0;
}

export const novoToken = () => hex(crypto.getRandomValues(new Uint8Array(32)));
export const resumoDoToken = async (t: string) => hex(await crypto.subtle.digest("SHA-256", enc.encode(t)));

/* "Ryan" + "ppautomoveis" = "ryanppautomoveis": minúsculo, sem acento e sem espaço */
export const normalizaUsuario = (u: string) => u.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, "");

/* senha padrão de cada pessoa: "pp" e seis números, fácil de digitar no celular, diferente para cada um */
export const senhaPadrao = () => "pp" + String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");

/* errou 10 vezes seguidas: o usuário fica 15 minutos sem conseguir entrar */
export const MAX_FALHAS = 10;
export const BLOQUEIO_MIN = 15;
export const SESSAO_DIAS = 30;
