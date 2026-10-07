# Guida cliente — caricamento immagini CFV

Questa guida spiega l’intera procedura. Non sono necessarie conoscenze tecniche.

## Prima volta: installare Node.js

1. Apri [https://nodejs.org/](https://nodejs.org/).
2. Scarica la versione indicata come **LTS**.
3. Completa l’installazione lasciando le opzioni proposte.
4. Chiudi eventuali finestre del programma e riapri il launcher.

Node.js va installato una sola volta su ogni computer.

## 1. Inserire le immagini

Apri la cartella:

```text
media → raw
```

Dentro `raw` deve esserci una cartella per ogni precodice, per esempio:

```text
media/raw/CFV/
media/raw/MANN/
media/raw/UFI/
```

Copia ogni immagine direttamente nella cartella del suo precodice. Non creare ulteriori sottocartelle.

Esempi corretti:

```text
media/raw/CFV/50268A__1.jpg
media/raw/CFV/50268A__2.jpg
media/raw/MANN/HU713_1X-1.jpg
```

Formati accettati:

```text
JPG, JPEG, PNG, WEBP, TIF, TIFF
```

### Come nominare le immagini

Il nome normale è:

```text
CODICEPRODOTTO__NUMERO.jpg
```

Esempio: `50268A__2.jpg`.

Il numero indica l’ordine nella gallery:

- `__1` viene prima di `__2`;
- il numero più basso è l’immagine principale;
- un file senza numero viene considerato posizione `0`.

Per il precodice MANN sono già previste regole speciali e il numero può essere preceduto da un trattino, come in `HU713_1X-1.jpg`.

Non creare due file con lo stesso codice e numero, anche se hanno estensioni diverse. Per esempio `50268A__1.jpg` e `50268A__1.png` entrerebbero in conflitto.

## 2. Avviare il programma

### Su Windows

Fai doppio clic su:

```text
AVVIA-WINDOWS.bat
```

### Su Mac

Fai doppio clic su:

```text
AVVIA-MAC.command
```

Al primo avvio il programma installa automaticamente alcuni componenti. Servono una connessione Internet e qualche minuto. Gli avvii successivi saranno più rapidi.

Lascia aperta la finestra fino al messaggio finale.

## 3. Leggere i controlli

Il programma controlla le immagini prima di elaborarle.

- `ATTENZIONE`: un file non supportato verrà ignorato; le altre immagini possono continuare.
- `ERRORE`: il processo si ferma. Il messaggio indica il file da spostare o rinominare.

Dopo la correzione, apri nuovamente il launcher.

## 4. Confermare il caricamento

Al termine dell’elaborazione compare un riepilogo con:

- file nuovi o modificati;
- file già presenti online;
- eventuale aggiornamento dei manifest;
- immagini remote conservate.

Il programma chiede:

```text
Vuoi caricare queste modifiche su R2? [s/N]
```

- Digita `s` e premi Invio per caricare.
- Premi soltanto Invio, oppure digita `n`, per annullare.

La scelta predefinita è **No**. Se annulli, le immagini elaborate restano sul computer e potrai ripetere l’operazione più tardi.

Durante l’upload non chiudere la finestra.

## Cosa fa il programma in sicurezza

- Rielabora soltanto immagini nuove o modificate.
- Carica soltanto file nuovi o modificati.
- Pubblica i manifest solo dopo aver completato le immagini.
- Non cancella immagini da R2.
- Conserva online le immagini già pubblicate anche se non sono presenti nella cartella locale.
- Non mostra mai le credenziali R2.

Se non ci sono modifiche, compare:

```text
È già tutto aggiornato. Nessun caricamento necessario.
```

## Problemi comuni

### “Node.js non è installato” oppure “troppo vecchio”

Installa la versione LTS corrente da [https://nodejs.org/](https://nodejs.org/), poi riapri il launcher.

### “Configurazione R2 incompleta”

Nella cartella principale deve esserci il file `.env` preparato dal fornitore. Non inviare questo file o il suo contenuto in chat o email non protette.

### “Formato non supportato”

Il file indicato non è un’immagine accettata. Convertilo in JPG o PNG, oppure rimuovilo dalla cartella.

### “L’immagine deve trovarsi direttamente…”

Sposta il file direttamente in:

```text
media/raw/[PRECODICE]/
```

### “Collisione”

Due file genererebbero la stessa immagine online. Rinomina il numero finale o rimuovi il duplicato indicato.

### Errore di rete o upload interrotto

Controlla la connessione e avvia nuovamente il programma. I manifest non vengono pubblicati prima del completamento delle immagini e i file già caricati non vengono ricaricati inutilmente.

### Il Mac non apre `AVVIA-MAC.command`

Apri l’app Terminale, scrivi `chmod +x` seguito da uno spazio, quindi trascina il file `AVVIA-MAC.command` dentro la finestra del Terminale e premi Invio.

Riprova con il doppio clic. Se macOS mostra ancora un avviso di sicurezza, fai clic destro sul file e scegli **Apri**.

## Quando chiedere assistenza

Contatta il referente tecnico se:

- devi aggiungere un nuovo precodice con regole speciali;
- vuoi rimuovere immagini già online;
- il file `.env` manca o le credenziali non sono più valide;
- lo stesso errore ricompare dopo aver seguito le indicazioni sopra.

Quando chiedi assistenza, invia il testo dell’errore e il nome del file coinvolto. Non inviare mai il contenuto di `.env`.
