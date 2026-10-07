#!/bin/bash

PROJECT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
cd "$PROJECT_DIR" || exit 1

finish() {
  status="$1"
  echo
  if [ "$status" -eq 0 ]; then
    echo "Operazione terminata."
  else
    echo "Il programma si e fermato con un errore."
    echo "Leggi il messaggio sopra oppure consulta docs/GUIDA-CLIENTE.md."
  fi
  if [ -t 0 ]; then
    read -r -p "Premi Invio per chiudere questa finestra..."
  fi
  exit "$status"
}

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js non e installato."
  echo "Installa la versione LTS da https://nodejs.org e riapri questo file."
  finish 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null)"
if ! [[ "$NODE_MAJOR" =~ ^[0-9]+$ ]] || [ "$NODE_MAJOR" -lt 20 ]; then
  echo "La versione di Node.js installata e troppo vecchia."
  echo "Installa la versione LTS corrente da https://nodejs.org."
  finish 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm non e disponibile. Reinstalla Node.js dalla pagina https://nodejs.org."
  finish 1
fi

if [ ! -x "node_modules/.bin/tsx" ] || [ ! -x "node_modules/.bin/cross-env" ]; then
  echo "Prima configurazione: installazione dei componenti necessari..."
  echo "Questa operazione richiede una connessione Internet."
  npm ci --include=dev --no-audit --no-fund || finish 1
  echo
fi

npm run start
finish $?
