import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1";
import { confereSenha, hashSenha, normalizaUsuario, senhaPadrao } from "./acesso.ts";

Deno.test("senha confere com o próprio hash e recusa outra", async () => {
  const h = await hashSenha("pp123456");
  assert(await confereSenha("pp123456", h));
  assert(!(await confereSenha("pp123457", h)));
  assert(!(await confereSenha("pp123456", null)));
});

Deno.test("hash igual ao que o script em Python grava (hashlib.pbkdf2_hmac)", async () => {
  /* python3 -c "import hashlib;print(hashlib.pbkdf2_hmac('sha256',b'pp123456',bytes.fromhex('00112233445566778899aabbccddeeff'),100000).hex())" */
  const python = "pbkdf2$100000$00112233445566778899aabbccddeeff$34597ac6f1b7dc2a6a58d55e5f23d06c2c5fa673e73fbb5dac23832e68aef22a";
  assertEquals(await hashSenha("pp123456", "00112233445566778899aabbccddeeff"), python);
  assert(await confereSenha("pp123456", python));
});

Deno.test("usuário no padrão nome + loja, sem acento nem espaço", () => {
  assertEquals(normalizaUsuario("Ryan" + "ppautomoveis"), "ryanppautomoveis");
  assertEquals(normalizaUsuario(" Rafa PPAutomoveis "), "rafappautomoveis");
  assertEquals(normalizaUsuario("Júlio"), "julio");
  assertMatch(senhaPadrao(), /^pp\d{6}$/);
});
