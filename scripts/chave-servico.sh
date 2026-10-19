#!/usr/bin/env bash
# Imprime a chave service_role do projeto da PP. Aceita a saída da CLI em tabela (versões antigas) e em JSON (19/10/2026).
set -euo pipefail
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
"$RAIZ/scripts/supabase.sh" projects api-keys --project-ref qdzuwnqejtjbtcysteip 2>/dev/null | python3 -c '
import sys, json
t = sys.stdin.read()
try:
    d = json.loads(t); ks = d.get("keys", d) if isinstance(d, dict) else d
    print(next(k["api_key"] for k in ks if k.get("id") == "service_role" or k.get("name") == "service_role"))
except ValueError:
    print(next(l.split()[-1] for l in t.splitlines() if "service_role" in l))'
