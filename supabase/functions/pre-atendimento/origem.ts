// Origem do contato e veículo de interesse, lidos da primeira mensagem do lead.
// O portal abre o WhatsApp com o link do anúncio dentro; o anúncio do Meta chega como `referral` no webhook.
// Nada aqui chama rede: é função pura, testada em origem_test.ts.

export type Canal =
  | "WebMotors" | "Mercado Livre" | "Tráfego Pago" | "Mobi Auto" | "Na Pista" | "OLX"
  | "Clientes de Porta" | "Não identificado";

export type Origem = {
  canal: Canal;
  anuncio_id: string | null;   // amarra ao estoque por pa_veiculos.anuncios[canal]
  veiculo_texto: string | null; // o que o link diz do carro, para quando não houver ficha
  url: string | null;
  referral?: Record<string, unknown>;
};

/* referral do clique para WhatsApp (Meta Ads): source_type "ad", source_id, headline, ctwa_clid */
export type Referral = { source_type?: string; source_id?: string; source_url?: string; headline?: string; ctwa_clid?: string };

const DOMINIOS: Array<[RegExp, Canal]> = [
  [/(^|\.)webmotors\.com\.br$/, "WebMotors"],
  [/(^|\.)mercadolivre\.com\.br$|(^|\.)mercadolibre\.com$/, "Mercado Livre"],
  [/(^|\.)mobiauto\.com\.br$/, "Mobi Auto"],
  [/(^|\.)napista\.com\.br$/, "Na Pista"],
  [/(^|\.)olx\.com\.br$/, "OLX"],
];
/* sem link, a mensagem pronta do portal ainda costuma citar o nome dele */
const NOMES: Array<[RegExp, Canal]> = [
  [/web\s*motors/i, "WebMotors"],
  [/mercado\s*livre/i, "Mercado Livre"],
  [/mobi\s*auto/i, "Mobi Auto"],
  [/na\s*pista/i, "Na Pista"],
  [/\bolx\b/i, "OLX"],
];

const titulo = (s: string) =>
  s.split(/[-_\s]+/).filter(Boolean).map((p) => p.length <= 3 && /\d/.test(p) ? p : p[0].toUpperCase() + p.slice(1)).join(" ");

function lerUrl(texto: string): URL | null {
  const m = texto.match(/(https?:\/\/)?((?:[a-z0-9-]+\.)+(?:com\.br|com)\/[^\s]*)/i);
  if (!m) return null;
  try { return new URL(`https://${m[2]}`); } catch { return null; }
}

function detalhar(canal: Canal, url: URL): Pick<Origem, "anuncio_id" | "veiculo_texto"> {
  const partes = url.pathname.split("/").filter(Boolean);
  if (canal === "WebMotors" && partes[0] === "comprar" && partes.length >= 7) {
    /* /comprar/{marca}/{modelo}/{versao}/{portas}/{ano-ano}/{id} */
    const [, marca, modelo, versao, , anos, id] = partes;
    return { anuncio_id: /^\d+$/.test(id) ? id : null, veiculo_texto: `${titulo(marca)} ${titulo(modelo)} ${titulo(versao)} ${anos.replace("-", "/")}` };
  }
  if (canal === "Mercado Livre") {
    const m = url.pathname.match(/MLB-?(\d+)(?:-([^/]*?))?(?:-_JM)?$/i);
    if (m) return { anuncio_id: `MLB${m[1]}`, veiculo_texto: m[2] ? titulo(m[2].replace(/-_JM$/i, "")) : null };
  }
  /* demais portais: o id é a última sequência longa de dígitos do caminho */
  const ids = url.pathname.match(/\d{6,}/g);
  return { anuncio_id: ids ? ids[ids.length - 1] : null, veiculo_texto: null };
}

export function lerOrigem(texto: string, referral?: Referral | null): Origem {
  if (referral && (referral.source_type === "ad" || referral.ctwa_clid || referral.source_id)) {
    return {
      canal: "Tráfego Pago", anuncio_id: referral.source_id ?? null,
      veiculo_texto: referral.headline ?? null, url: referral.source_url ?? null,
      referral: referral as Record<string, unknown>,
    };
  }
  const url = lerUrl(texto || "");
  if (url) {
    const host = url.hostname.toLowerCase();
    const achado = DOMINIOS.find(([re]) => re.test(host));
    if (achado) return { canal: achado[1], url: url.toString(), ...detalhar(achado[1], url) };
  }
  const porNome = NOMES.find(([re]) => re.test(texto || ""));
  if (porNome) return { canal: porNome[1], anuncio_id: null, veiculo_texto: null, url: url?.toString() ?? null };
  return { canal: "Não identificado", anuncio_id: null, veiculo_texto: null, url: url?.toString() ?? null };
}
