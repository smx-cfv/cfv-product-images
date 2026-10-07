# CFV Product Images

Strumento per elaborare le immagini prodotto, generare i manifest JSON/CSV e pubblicare su Cloudflare R2 soltanto i file nuovi o modificati.

Per l’uso quotidiano non tecnico vedere la [Guida cliente](docs/GUIDA-CLIENTE.md).

## Avvio rapido

Requisiti:

- Windows 10/11 oppure una versione recente di macOS;
- versione LTS corrente di [Node.js](https://nodejs.org/) (minimo Node.js 20);
- connessione Internet al primo avvio e durante l’upload;
- file `.env` già configurato con un token R2 dedicato.

Il cliente deve usare uno solo di questi file:

- macOS: `AVVIA-MAC.command`;
- Windows: `AVVIA-WINDOWS.bat`.

Al primo avvio il launcher esegue automaticamente `npm ci`. In seguito apre il flusso guidato, che:

1. controlla configurazione, cartelle, formati e collisioni;
2. elabora tutte le immagini;
3. confronta i risultati con il manifest remoto;
4. mostra il riepilogo;
5. carica soltanto dopo una conferma esplicita `s/N`.

La risposta predefinita è **No**. Annullare l’upload non elimina i file elaborati localmente.

## Struttura delle cartelle

```text
media/
├── raw/
│   ├── CFV/
│   │   ├── 50268A__1.jpg
│   │   └── 50268A__2.jpg
│   └── MANN/
│       └── HU713_1X-1.jpg
└── processed/
    └── products/
```

Ogni immagine deve essere direttamente dentro `media/raw/[PRECODICE]/`. Il flusso guidato rifiuta immagini nella radice di `raw` o in ulteriori sottocartelle.

Formati supportati: `.jpg`, `.jpeg`, `.png`, `.webp`, `.tif`, `.tiff`.

### Regole dei nomi

Il formato standard è:

```text
[CODICE_PRODOTTO]__[POSIZIONE].[estensione]
```

Esempio: `50268A__2.jpg`.

- ciò che precede `__` è il codice prodotto;
- il numero finale è la posizione nella gallery;
- il numero più basso diventa l’immagine principale;
- se il numero manca, la posizione è `0`.

Le regole speciali sono in `media.config.json`. Per esempio, il precodice MANN accetta anche `-` prima della posizione e converte `_` in stringa vuota e `.` in `/` nel codice prodotto.

Due sorgenti con stesso precodice, codice grezzo e posizione produrrebbero gli stessi file. Il preflight guidato rileva questa collisione e blocca il processo.

## Elaborazione e manifest

Ogni sorgente viene:

- ruotata secondo i metadati EXIF;
- convertita in WebP;
- ridimensionata alle larghezze configurate, senza ingrandire immagini più piccole;
- salvata in `media/processed/products/`;
- identificata da checksum per riutilizzare il risultato quando non è cambiata.

I file di output seguono questo schema:

```text
[PRECODICE]__[CODICE_GREZZO]__[POSIZIONE]-[LARGHEZZA].webp
```

Il processo genera nella root:

- `manifest.json`, usato dai sistemi applicativi;
- `manifest.csv`, utile per importazioni e verifiche.

L’elaborazione locale è atomica: i prodotti già validi vengono sostituiti soltanto quando la nuova elaborazione è terminata.

## Sicurezza e comportamento R2

Le credenziali sono lette esclusivamente dal file `.env`:

```dotenv
R2_BUCKET_NAME=
R2_BUCKET_DOMAIN=https://img.example.com
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_ENDPOINT=https://ACCOUNT_ID.r2.cloudflarestorage.com
```

Usare `.env.example` come modello. Il file `.env` reale:

- non deve essere salvato in Git;
- non deve essere inviato via canali pubblici;
- deve contenere un token dedicato, limitato al solo bucket e ai permessi minimi disponibili;
- non viene mai stampato nei log.

L’upload è additivo:

- carica solo varianti nuove o modificate;
- pubblica `manifest.csv` e `manifest.json` per ultimi;
- conserva nel manifest gli asset remoti assenti localmente;
- non invia mai operazioni di cancellazione a R2.

La rimozione remota non è supportata dal flusso ordinario.

## Comandi avanzati

Installazione:

```bash
npm ci --include=dev
```

Flusso guidato:

```bash
npm start
```

Elaborazione:

```bash
npm run media:process
npm run media:process -- --pre=MANN --limit=100 --concurrency=4 --dry-run
```

Anteprima upload, senza scritture su R2:

```bash
npm run media:uploads
npm run media:uploads -- --pre=MANN --limit=100 --concurrency=6
```

Upload reale:

```bash
npm run media:uploads -- --pre=MANN --limit=100 --concurrency=6 --confirm
```

Opzioni:

| Opzione | Comando | Significato |
| --- | --- | --- |
| `--pre=MANN` | entrambi | limita il batch a un precodice |
| `--limit=100` | entrambi | limita il numero di immagini/asset selezionati |
| `--concurrency=4` | entrambi | imposta il parallelismo |
| `--dry-run` | processing | analizza senza scrivere output |
| `--confirm` | upload | autorizza scritture R2 e manifest |

Senza `--confirm`, l’upload è sempre una simulazione.

## Configurazione

`media.config.json` controlla:

- cartelle sorgenti e destinazioni;
- percorsi dei manifest e dello stato locale;
- larghezze WebP;
- separatori numerici predefiniti;
- mapping specifici per precodice.

Le modifiche al mapping possono cambiare il `product_code` pubblicato. Eseguire prima un dry-run e verificare i manifest.

## Test

```bash
npm run check
npm test
```

La suite copre parsing, preflight, processing incrementale, progressi, anteprima e conferma guidata, ordine di pubblicazione e conservazione degli asset remoti.

## Preparazione dello ZIP cliente

Creare una copia pulita del progetto escludendo:

- `.git`;
- `node_modules`;
- `.media-state`;
- `.DS_Store` e altri file di sistema;
- vecchi ZIP o log locali.

Includere:

- codice sorgente, `package.json` e `package-lock.json`;
- launcher, README e `docs/GUIDA-CLIENTE.md`;
- `media.config.json`;
- `.env` con token cliente dedicato;
- `media/raw`, `media/processed`, `manifest.json` e `manifest.csv` se si vuole consegnare lo stato corrente.

Quando si includono risultati esistenti, cartelle `raw` e `processed` e i due manifest devono provenire dalla stessa elaborazione completata.

Non includere `node_modules` da un Mac in uno ZIP destinato a Windows o viceversa: Sharp usa componenti nativi specifici per sistema operativo. Il launcher installerà quelli corretti.

## Risoluzione rapida dei problemi

- **Node.js non è installato / troppo vecchio:** installare la versione LTS corrente da [nodejs.org](https://nodejs.org/) e riaprire il launcher.
- **Configurazione R2 incompleta:** verificare che `.env` esista nella root e contenga tutte le cinque variabili richieste.
- **Formato non supportato:** convertire il file in uno dei formati ammessi; il file viene ignorato.
- **Percorso non valido:** spostare l’immagine direttamente in `media/raw/[PRECODICE]/`.
- **Collisione:** rinominare o rimuovere uno dei file elencati; entrambi produrrebbero la stessa chiave R2.
- **Errore di rete:** non vengono pubblicati manifest incompleti; controllare la connessione e rilanciare.
- **macOS non apre il launcher:** dalla root eseguire `chmod +x AVVIA-MAC.command`, quindi riaprirlo.
