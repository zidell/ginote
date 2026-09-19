[![CI](https://github.com/zidell/ginote/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/zidell/ginote/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/zidell/ginote/branch/main/graph/badge.svg)](https://codecov.io/gh/zidell/ginote)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[English](README.md) | [한국어](README.ko.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md) | [Deutsch](README.de.md) | [Français](README.fr.md) | **Italiano** | [Español](README.es.md)

# Ginote

## Informazioni

Ginote è un'app web semplice e sicura che permette di usare le Issues di GitHub come
note personali. Personalmente mi piacciono le Issues di GitHub, ma la loro lentezza e la
UX scomoda mi hanno sempre infastidito. Così ho creato una SPA che ne mantiene quasi
tutte le funzionalità, offrendo però l'esperienza d'uso di un'app per le note. L'app è
composta solo da JS statico e il browser comunica direttamente con l'API di GitHub,
per questo è sicura.

App online (utilizzabile liberamente da chiunque): [https://note.gitools.net](https://note.gitools.net)

## Anteprima

![Anteprima di Ginote](docs/preview.gif)

Come rigenerare la GIF di anteprima è spiegato in [docs/screencasting.md](docs/screencasting.md).

## Caratteristiche principali

- **Salvataggio diretto in un repository privato:** le Issues di un repository privato
  fungono da note, senza server applicativo né database dedicati.
- **Connessione diretta dal browser:** il browser chiama direttamente l'API di GitHub.
  Non esiste alcun passaggio intermedio in cui un server del gestore dell'app riceve o
  conserva le tue note o il tuo PAT.
- **Tag, ricerca e cestino:** le label di GitHub vengono usate come tag (a ogni tag si può
  aggiungere una descrizione), con ricerca nel testo e un cestino basato sulle Issues
  chiuse. Le note che consulti spesso possono essere fissate in alto.
- **Commenti:** i commenti delle Issues fungono da voci aggiuntive di una nota. Anche ai
  commenti puoi allegare file o dettarli a voce.
- **Allegati di file e immagini:** gli allegati di note e commenti sono salvati nello
  stesso repository e consultabili sia nell'app sia su GitHub. Per i dettagli vedi
  [come vengono salvati gli allegati](docs/ATTACHMENTS.md).
- **Registrazione vocale, trascrizione e rifinitura (solo OpenAI):** l'audio registrato
  nel browser viene trascritto direttamente da OpenAI, e la trascrizione può essere
  rifinita in un testo scritto naturale. In questa fase si possono anche generare un
  titolo e ricevere suggerimenti di tag esistenti; se serve, l'audio originale può essere
  conservato come allegato della nota. Le funzioni vocali supportano per ora solo l'API
  di OpenAI.
- **Blocco delle note (crittografia aggiuntiva):** se un repository privato non basta,
  blocca una nota con un codice di 6 cifre per cifrarne ulteriormente testo e commenti
  nel browser con AES-GCM. Per i dettagli vedi [come funziona la crittografia](docs/ENCRYPTION.md).
- **Strumenti di modifica:** unire più note in una sola, cercare e sostituire nel testo
  (con supporto alle espressioni regolari) e visualizzare il risultato nel visualizzatore
  Markdown.
- **Più repository:** registra più repository e passa dall'uno all'altro dall'elenco o
  con i tasti numerici.
- **Controllo da tastiera:** scorrere, aprire e selezionare le note, crearne di nuove e
  cambiare repository direttamente da tastiera.
- **Integrazione MCP:** collegando il server MCP ufficiale di GitHub, anche i tuoi
  strumenti di IA possono leggere e scrivere le stesse note (Issues). Non serve alcun
  server MCP specifico per l'app.
- **Web e desktop:** disponibile come PWA installabile e come app per macOS, Windows e
  Linux basate su Tauri. Per il packaging e i rilasci dell'app desktop consulta la
  [documentazione dell'app desktop](docs/DESKTOP.md).

## Utilizzo

### Dove finiscono i miei dati?

**Ginote è un'app web statica distribuita sotto forma di file.** Il server di hosting
consegna solo i file dell'app, come HTML, CSS e JavaScript. Non esiste un backend che
gestisca l'accesso o il salvataggio delle note: una volta aperta l'app, tutto lo scambio
di dati avviene direttamente tra il tuo browser e l'API di GitHub.

```text
Il tuo browser  ←──── connessione diretta ────→  GitHub
     │
     └─ PAT, impostazioni e bozze non salvate restano solo in questo browser
```

- Note, tag e allegati vengono salvati solo nel repository GitHub che indichi.
- Il PAT e le impostazioni dell'app sono conservati solo nel tuo browser e vengono
  inviati all'API di GitHub solo per l'autenticazione.
- Le bozze non salvate restano solo in quel browser.
- La crittografia facoltativa delle note è descritta in
  [come funziona la crittografia](docs/ENCRYPTION.md).
- Non esiste alcuna API che invii note, PAT o impostazioni al gestore dell'app, e non
  vengono usati servizi di analisi o tracciamento.

In breve, a parte le richieste per scaricare i file dell'app, nessuno dei tuoi dati
viene inviato al gestore dell'app o a server diversi da GitHub. I dati delle note
esistono davvero **solo nel tuo browser e nel repository GitHub che hai scelto**.

### Usare la registrazione vocale

Prima di usare la registrazione vocale per la prima volta serve una chiave API di
OpenAI. Crea una chiave API su OpenAI e inseriscila in Ginote in
**Impostazioni → Registrazione vocale → Chiave API OpenAI**. OpenAI potrebbe addebitare
costi in base all'utilizzo dell'API.

Una volta configurata, avvia la registrazione con il pulsante del microfono nella barra
laterale o nella schermata della nota. Al termine, l'audio viene trascritto e poi
vengono applicati il modello e le regole di rifinitura (facoltativi) per proporre testo,
titolo e tag esistenti. Nelle impostazioni puoi cambiare il modello di trascrizione, il
modello di rifinitura e il vocabolario usato di frequente per la trascrizione; lasciando
vuoto il modello di rifinitura viene salvata solo la trascrizione. Attivando
**Conserva audio originale**, anche l'audio originale delle registrazioni riuscite viene
salvato come allegato della nota.

I file audio e le trascrizioni vengono inviati direttamente dal browser all'API di
OpenAI, senza passare da un server dell'app. La chiave API è salvata in chiaro nel
`localStorage` del browser di questo dispositivo: usala quindi solo su dispositivi
personali. Consigliamo una chiave di progetto dedicata, limiti di utilizzo e una
rotazione periodica.

### Scorciatoie da tastiera

Nell'elenco delle note sono disponibili le seguenti scorciatoie. Mentre scrivi in un
campo di input le scorciatoie dell'elenco non funzionano. `Ctrl/Cmd + R` è la
scorciatoia di ricarica del browser, quindi ricarica l'app da qualsiasi punto.

| Tasto | Azione |
| --- | --- |
| `↑` / `↓` | Spostarsi nell'elenco delle note |
| `Enter` | Aprire la nota corrente · premere di nuovo per modificarla |
| `N` | Creare una nuova nota |
| `` ` `` | Aprire il selettore dei repository |
| `1`–`9` | Cambiare repository nell'ordine di registrazione |
| `Esc` | Annullare la selezione · annullare l'eliminazione · chiudere i suggerimenti |
| `Space` | Selezionare la nota corrente |
| `Shift` + `↑` / `↓` | Selezionare un intervallo di note |
| `Delete` / `Backspace` | Spostare le note selezionate nel cestino |
| `Ctrl/Cmd + R` | Ricaricare l'app |

Quando una nota è aperta e nessun campo di input ha il focus, sono disponibili anche
queste scorciatoie.

| Tasto | Azione |
| --- | --- |
| `T` | Aggiungere un tag |
| `A` | Allegare un file |
| `P` | Fissare in alto / sbloccare |
| `L` | Bloccare · sbloccare |
| `Delete` | Spostare la nota nel cestino |
| `G` | Visualizzare la Issue su GitHub |
| `M` | Aprire · chiudere il visualizzatore MD |
| `R` | Ricaricare l'intera app |
| `S` | Salvare la nota corrente |

### PWA (app web installabile)

Le build di produzione funzionano come PWA, installabile dal browser e utilizzabile come
un'app. Apri l'app online nel browser e usa il menu di installazione del browser. Il
manifest e il service worker non dipendono da alcun dominio o servizio di hosting
specifico e funzionano in base al percorso in cui l'app è distribuita. Il service
worker (la funzione che permette al browser di conservare temporaneamente i file
dell'app) memorizza nella cache solo i file della stessa origine dell'app e mai le
richieste all'API di GitHub, il PAT o i dati delle note.

### Scaricare l'app desktop

I programmi di installazione per macOS, Windows e Linux sono disponibili su
[GitHub Releases](https://github.com/zidell/ginote/releases). macOS usa un DMG e
Windows 10/11 un MSI. Le nuove versioni per Windows saranno pubblicate come MSI firmati
una volta configurata la firma tramite SignPath Foundation. L'app desktop apre
[note.gitools.net](https://note.gitools.net) e richiede una connessione a Internet. Le
modifiche all'interfaccia e alle funzioni generali vengono distribuite tramite il
deploy web.

[Code signing policy](docs/CODE_SIGNING.md)

L'installazione con Homebrew su macOS, l'esecuzione in locale, il packaging per ciascuna
piattaforma e la procedura di rilascio sono descritti nella
[documentazione dell'app desktop](docs/DESKTOP.md).

## Gestione e sviluppo

Quando modifichi l'app web, installa le dipendenze a partire dal lockfile e assicurati
che controlli statici, test e build di produzione passino tutti prima del deploy. L'app
viene distribuita come file statici, mentre il packaging e la firma dell'app desktop
sono gestiti separatamente dal deploy web. Le modifiche che toccano il formato dei dati
o la sicurezza vanno prima verificate rispetto ai documenti su allegati e crittografia.
Ambiente di sviluppo, comandi di verifica e procedure di deploy e manutenzione sono
descritti nella [documentazione di sviluppo e gestione](docs/DEVELOPMENT.md).

## Richieste di funzionalità

Se desideri una funzionalità, fai un fork del progetto e modificalo tu stesso. Per le
mie esigenze è già più che sufficiente, quindi non accetto proposte di nuove
funzionalità.

## Licenza

[MIT License](LICENSE)
