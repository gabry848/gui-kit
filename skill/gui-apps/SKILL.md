---
name: gui-apps
description: "Creare, avviare e gestire app da terminale fatte con gui-kit (Ink 8 su Bun). Copre le app al volo, che chiedono qualcosa all'utente e restituiscono la risposta in JSON con gui ask, e le app complete salvate e installate per nome (gui <app>). Usare quando l'utente chiede un'interfaccia, un form, una scelta, una tabella o un canvas nel terminale, oppure di aprire, installare o disinstallare una di queste app."
---

# App da terminale con gui-kit

Ogni app occupa a schermo intero il terminale in cui parte e non gestisce finestre: i terminali li gestisce l'utente in Ghostty, oppure tu con ghostty-mcp. Il kit e la CLI stanno in `~/Documents/AiAgents/lab/gui-kit`. Il comando `gui` è in `~/.local/bin/gui`.

## Scegliere il tipo di app

- **Al volo:** un solo file `.tsx`, scritto dove serve (per esempio nello scratchpad), senza installare nulla. Serve per chiedere all'utente una scelta, i campi di un form o una conferma.
- **Salvata:** una cartella con `gui.json` e `app.tsx`, installata col suo nome. Si crea con `gui new <nome>`, oppure da un file al volo con `gui new <nome> --from file.tsx`.

## Comandi

```sh
gui <app> [argomenti]          # avvia un'app installata
gui run <app|cartella|file> [argomenti]
gui ask <app|file> [argomenti] # stdout: solo il JSON passato a finish()
gui screen <app|file> [--keys 'K'] [--cols 100] [--rows 30] [argomenti]
gui check <app|cartella|file>  # tipi + prova di avvio senza terminale
gui new <nome> [--dir D] [--from file.tsx] [--description T]
gui install [cartella] [--bin] | gui uninstall <nome> | gui ls [--json]
```

- **`gui ask`** disegna sul terminale e scrive su stdout solo il JSON, quindi `risposta=$(gui ask form.tsx)` funziona come con fzf. Codici d'uscita:
  - 0 con una riga JSON;
  - 1 se l'app si chiude senza `finish()` (`q`, `:q`, `Ctrl-C`) o va in errore;
  - 2 per errori della CLI (app inesistente, nessun export di default).
  Controlla sempre il codice d'uscita, non solo il file.
- **`gui new`** crea `./<nome>` nella cartella corrente se non passi `--dir`. Scrive `gui.json`, `app.tsx` e `tsconfig.json` e installa subito l'app. Il nome usa minuscole, cifre e trattini; i nomi dei sottocomandi (`run`, `ask`, `ls`...) sono rifiutati.
- **`gui install --bin`** crea anche il comando `~/.local/bin/<nome>`. `gui uninstall` toglie l'app dal registro e quel comando, ma non cancella i file.
- **Registro:** è in `$GUI_HOME/registry.json`, per default `~/.local/share/gui/registry.json`. Per prove che non devono toccare il registro vero usa `HOME=<tmp> GUI_HOME=<tmp>/gui gui ...`.

## Scrivere un'app

- Il file esporta di default il componente principale.
- Importa tutto da `'gui-kit'`, che espone:
  - i componenti del kit;
  - `theme`, `useFinish`, `useKeys`, `useCommand`, `useMouse`, `useKit`, `useKeymapState`;
  - da Ink: `Box`, `Text`, `Newline`, `Spacer`;
  - da React: `useState`, `useEffect`, `useRef`, `useMemo`, `useCallback`.
- Non c'è altro: niente `useReducer`, `useContext`, `useWindowSize`, `useInput`. Non importare `ink` direttamente: caricherebbe una seconda copia di Ink, che legge il terminale sbagliato, e `gui check` fallisce. Da `react` importa al massimo i tipi (`import type {ReactNode} from 'react'`).
- Avvolgi la schermata in `<Shell title="...">`. Lo Shell dà la barra di stato, la riga `:`, l'aiuto `?`, il menu dei tasti composti e `q` per uscire.
- Per restituire un risultato prendi `const finish = useFinish()` nel corpo del componente e chiama `finish(valore)` in un gestore. L'app si chiude subito. Il valore deve essere serializzabile in JSON: usa `null`, non `undefined`.
- Gli argomenti dopo l'app arrivano in `process.env.GUI_ARGS` (array JSON); leggili con `JSON.parse(process.env.GUI_ARGS ?? '[]')`. La cartella dell'app è in `GUI_APP_DIR`; per un file singolo è la sua cartella. Vale per `gui <app>`, `run`, `ask` e `screen`.
- Da `useKit()` hai:
  - `caps`: cosa supporta il terminale, per esempio `caps.graphics`;
  - `keymap.flash('messaggio')`: un messaggio nella barra di stato.

```tsx
import {Form, Shell, useFinish} from 'gui-kit';

export default function App() {
	const finish = useFinish();
	return (
		<Shell title="Nuovo cliente">
			<Form
				fields={[
					{name: 'nome', label: 'Nome', type: 'text', placeholder: 'Mario Rossi'},
					{name: 'tipo', label: 'Tipo', type: 'select', options: ['privato', 'azienda']},
					{name: 'newsletter', label: 'Newsletter', type: 'checkbox'},
				]}
				onSubmit={finish}
			/>
		</Shell>
	);
}
```

## Componenti

| Componente | Uso |
|---|---|
| `Shell` | Cornice di ogni app: `title`, `hint` facoltativo per la barra di stato. |
| `List` | Elenco lungo: `items`, `render(item, selected)`, `text(item)` per la ricerca, `onOpen`, `active`. Si usa con `j`/`k` o le frecce, `gg`/`G`, `Ctrl-d`/`Ctrl-u`, `/` filtra, Invio apre. La rotella scorre; un clic seleziona e un secondo clic sulla riga evidenziata apre. |
| `Select` | Scegliere un'opzione (`{label, value, hint?}`): `onSelect` riceve `value`. Stessi tasti e clic di `List`. |
| `Table` | `columns` (`{key, title, width?, align?, format?}`), `rows`, `onOpen`. `s` ordina per la colonna successiva, `S` inverte l'ordine. |
| `Form` | `fields` con tre tipi: `{name, label, type: 'text', placeholder?, default?}`, `{type: 'select', options, default?}`, `{type: 'checkbox', default?}`. Ha `onSubmit(valori)` e `submitLabel`. `j`/`k`, Tab o frecce cambiano campo; `h`/`l` cambiano scelta; `x` o Invio spunta; `Ctrl-s` invia da qualsiasi campo, anche mentre scrivi. |
| `TextInput` | Una riga di testo (`value`, `onChange`, `onSubmit`, `placeholder`, `active`). In modo normale le lettere sono comandi: `i`, `a` o Invio iniziano a scrivere, `cc` svuota e scrive, `Esc` o Invio finiscono. |
| `Confirm` | Domanda sì/no: `y` o Invio sì, `n` o `Esc` no. Mentre è aperta copre `q`, `:` e `?`. |
| `Modal` | Finestra sopra la schermata (`title`, `onClose`, `bindings`). Prende i tasti finché è aperta; `q` ed `Esc` la chiudono. |
| `Canvas` | Disegno ridisegnato a ogni frame. Props obbligatorie: `backend` (`'braille'`, `'half'` o `'kitty'`), `version` (un numero da incrementare a ogni cambio, altrimenti non ridisegna) e `draw(raster, {sx, sy})`. Facoltative: `background` (RGB) e `onPointer`. |

**Canvas e `Raster`.**
- `draw` lavora in pixel del raster: il braille ha 2×4 pixel per cella, `'half'` 1×2, kitty fino a 10×20.
- Metodi di `Raster`: `plot(x, y, c)`, `dot(cx, cy, r, c)`, `line`, `rect` ed `ellipse` (tutti con `(x0, y0, x1, y1, raggio, c)`), `clear()`.
- I colori sono terne `[r, g, b]`, non i colori esadecimali di `theme`.
- `onPointer` riceve `{kind: 'down'|'up'|'drag'|'wheel', button, x, y}` in celle, con decimali.

## Tasti: stile Vim

- `:` apre la riga di comando: `:q` esce, `:help` mostra l'aiuto. `?` mostra l'aiuto generato dai tasti. `q` esce dall'app, oppure chiude l'aiuto o un `Modal`.
- `Esc` non esce dall'app. Annulla i tasti in sospeso e i conteggi, torna al modo normale dall'inserimento o dalla riga di comando, chiude aiuto e `Modal`, e in `Confirm` risponde no.
- I movimenti li danno i componenti (vedi la tabella), non lo Shell. I conteggi valgono ovunque: `5j`.
- `Spazio` non fa nulla da solo. Usalo come prefisso per i tasti della tua app (`<Space>1`, `<Space>f`): il menu dei tasti composti li mostra.
- I tasti dell'app si aggiungono con `useKeys([{keys: 'dd', desc: 'Elimina', group: 'Lista', run: count => ...}], {active, modal, priority})`:
  - `desc` e `group` sono in italiano e compaiono nell'aiuto; `group: 'hidden'` li nasconde;
  - la notazione è quella di Vim (`gg`, `<C-d>`, `<CR>`, `<Esc>`, `<Space>x`);
  - un `useKeys` con `modal: true` copre tutti i tasti sotto di lui.
- I comandi `:nome` si aggiungono con `useCommand('nome', 'descrizione', argomenti => ...)`.
- Non ridefinire `:`, `?` e `q` a livello di app. Una finestra modale sì, può usare `q` ed `Esc` per chiudersi.
- Tieni attiva una sola `List`, `Select` o `Table` alla volta (prop `active`): la ricerca `/` ha un solo destinatario, e la lista registrata per ultima vince `j`/`k`.

## Stile

- Colori solo da `theme` (`theme.accent`, `theme.text`, `theme.muted`, `theme.success`, `theme.warning`, `theme.danger`...), mai valori fissi.
- Testi dell'interfaccia in italiano e brevi. In cima a ogni schermata metti una riga che dice cosa si può fare.
- Niente finestre o pannelli multipli dentro l'app. Per una seconda vista usa una schermata gestita con uno stato e tasti tuoi: per convenzione `gt`/`gT` e `<Space>1`/`<Space>2`, come nella demo `~/Documents/AiAgents/lab/gui-kit/src/apps/demo/Demo.tsx`. Il kit non li fornisce. In alternativa usa un `Modal`.

## Grafica

- Usa `backend="braille"` (o `'half'`): funziona in ogni terminale, anche in tmux e ssh.
- I pixel veri (grafica kitty) servono solo se l'utente li vuole. Passa `backend={caps.graphics === 'kitty' ? 'kitty' : 'braille'}`. `caps.graphics` vale `'kitty'` solo con `GUI_GRAPHICS=kitty`, un terminale che risponde alla query kitty e fuori da tmux; in tutti gli altri casi il `Canvas` torna da solo al braille.
- Il kit invia le immagini in PNG e non deve mai usare `o=z`: Ghostty 1.3.1 va in crash su stream zlib a Huffman fisso, e il crash chiude tutte le schede dell'utente (`~/Documents/AiAgents/lab/gui-kit/bench/ghostty-zlib-crash.md`). Le novità grafiche si provano solo in un'istanza separata di Ghostty (`open -na Ghostty.app --args --window-save-state=never`), mai nella Ghostty dell'utente. In tmux la grafica kitty è sempre spenta.

## Verificare prima di consegnare

1. `gui check app.tsx` deve stampare `tipi ok` e `si avvia e si disegna`. La seconda riga controlla anche l'export di default e il primo disegno.
2. `gui screen app.tsx --keys '...'` stampa lo schermo dopo i tasti. Prova i tasti principali e `?`. Dopo lo schermo stampa:
   - `[finish] <json>` se l'app ha chiamato `finish()`;
   - `[uscita]` se si è chiusa senza `finish()` (per esempio con `q`);
   - se l'app va in errore, esce con 1 e mette l'errore su stderr.
   In tutti e tre i casi lo schermo stampato è l'ultimo frame prima dell'uscita.
3. Limiti di `gui screen`:
   - niente mouse;
   - aspetta circa 80 ms dopo l'ultimo tasto;
   - un prefisso ambiguo alla fine (`g` quando esistono `gg` e `gt`) scatta solo dopo 700 ms, quindi non terminare `--keys` con un prefisso;
   - per scrivere in un campo premi prima `i`.
4. Per mostrare l'app all'utente usa ghostty-mcp:
   - `open_terminal` con `where: "window"` o `"tab"`;
   - `send_text` con `gui <app>`, oppure `gui ask file.tsx > risposta.json; echo "uscita=$?"`;
   - `read_screen` o `wait_for` per controllare;
   - alla fine leggi il file e il codice d'uscita.
5. Riporta cosa hai verificato e come: senza terminale, dal vivo, o non verificato.
