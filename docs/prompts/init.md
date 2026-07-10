È necessario creare un sistema per processare le immagini e caricarle in R2
In questa folder puoi vedere un esempio di cosa intendo
/Users/tizianovolpe/dev/bagful-flowpress


## Contesto
Cenro Filtri Veneto è un rivenditore di filtri per macchinari.
Le immagini dei filtri vanno hostate e condivise con diversi sistemi:
- erp aziendale
- ecommerce b2c
- ecommerce b2b
- ...
È necessaria un unica fonte di dati dove le immagini sono caricate e preenti, dove è presente un manifest che associ ogni immagine ad ogni codice prodotto.

## immagini
Le immagini iniziali risiedono dentro a `media/raw/[precodice]/[immagine].jpg`
Il nome delle immagini è questo nella folder raw è questo:
`[codice_prodotto_contentente_diversi_caratteri]__[numero].jpg`
Si utilizza la formula doppio underscore `__` come delimitarore, quello che c'è prima è il codice del prodotto, quello che c'è dopo è il numero dell'immagine.
È necessario indicare un numero di immagine perché un prodotto può avere più di un immagine.
Riguardo il numero delle immagini la regola è: più basso è il numero più è rilevante e va mostrata prima nella gallery prodotto dell'ecommerce.
l'immagine con il numero più bassso, o l'immagine senza numero è l'immagine principale.
Le immagini di esempio presenti in questo progetto hanno tutte estensione `.jpg` ma è possibile che ci siano anche `.png` o altre estensioni.

## Image processing
Lo script deve:
- processare tutte la immagini presenti in raw
- definire checksum in modo che non vengano processate immagini già processate in precedenza e non modificate (deve quindi leggere il manifest dell'export precedente)
- convertire in webp tutte le imamagini e ridimensionarle a larghezza 480px, 768px, 1024px - l'altezza è variabile in base alle dimensioni dell'immagine
- caricare le immagini processate in `media/processed/products/`
- il nome dell'immagine diventerà [precodice]__[nome-immagine]__[numero]-[size].webp

## Codici prodotto
I codici prodotto sono sempre quelli prima dei doppi underscore `__`
esempio:
Immagine: `50268A__1.jpg`
Codice prodotto: `50268A`
Numero immagine: `1`

### Regole custom per precodici / codici prodotto
Alcuni codici prodotto possono avere caratteri non permessi nei nomi dei file ad esempio `/` quindi per convensione i nomi dei prodotti utilizzando dei caratteri sostitutivi.
Questa convezione è differente per ogni precodice.
Esempio:
Precodice `MANN`
pre il precodice `MANN` la convenzione è
underscore = none -> `_` = ``
punto = / -> `.` = `/`
Quindi l'immagine 
`C_20.500__1.jpg`
è relativa al codice prodotto `C20/500`
e genererà le seguenti immagini processate:
`MANN__C_20.500__1-480.webp`
`MANN__C_20.500__1-768.webp`
`MANN__C_20.500__1-1024.webp`
È necessario quini realizzare un json per definire le regole di mapping per ogni precodice



## Manifest

Vanno realizzati 2 tipologie di manifest:
- json
- csv
  
i manifest 
risiedereanno della root del progetto:
- img.cfvfilter.com/manifest.json
- img.cfvfilter.com/manifest.csv



### Struttura suggerita

``` json

{
	"generatedAt": "AAAA-MM-GGT...."
	"assets": [
		{
			"product_code" : "[codice-prodotto]",
			"pre_code" : "[precodice]",
			"checksum" : "...",
			"position" : [number],
			"variants" : [
				{
					"slug" : "https://img.cfvfilter.com/products/[precodice]__[codiceprodotto]__[numero]-[size].webp",
					"width": 480,
				},
				{
					"slug" : "https://img.cfvfilter.com/products/[precodice]__[codiceprodotto]__[numero]-[size].webp",
					"width": 768,
				},
				{
					"slug" : "https://img.cfvfilter.com/products/[precodice]__[codiceprodotto]__[numero]-[size].webp",
					"width": 1024,
				}
			]
		}
	]
}

```

``` csv

precode,product_code,checksum,number,slug_480,slug_768,slug_1024
...

```

## Upload R2
Dopo il processing delle immagini è necessario fare upload su r2.
L'upload è sostitutivo delle sole immagini per cui il checksum è cambiato.
pertanto lo script dovrebbe:
1. Leggere manifest remoto
2. verificare quali immagini hanno checksum differente o quali sono asseinti
3. Caricare solo le modifiche / aggiunte
4. Caricare il manifest nuovo solo alla fine del processo

### Cancellazione media
Il lavoro su R2 dovrebbe essere solo additivo e di modifica. mai di cancellazione a meno che non venga richiesto attraverso comando specifico.

## Comandi pnpm
È necessario precedere:
- comando processing `pnpm media:process`
- comando upload `pnpm media:uploads`

per entrambi i comandi deve essere possibile gestire batch parziali (i media sono moltissimi)
quindi dobrebbe essere possibile definire:
- parziale precodice `--pre=MANN` 
- altro?

Considerando le molte immagini potrebbe essere utile gestire un piccolo log di processo dove viene salvata l'ultima immagine processata in modo che se il lavoro viene interrotto si può ripartire dall'interruzione senza dover ripartire dall'inizio

## ENV R2
Ho già caricato in env le seguenti variabili

```
R2_BUCKET_NAME
R2_BUCKET_DOMAIN
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_ENDPOINT
```