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

`<app>` può essere il nome di un'app installata, una cartella con `gui.json` o un file `.tsx`. Un nome senza `/` indica sempre l'app installata, anche se nella cartella corrente c'è una cartella omonima: per la cartella scrivi `./nome`.

```sh
gui <nome> [argomenti]             # avvia un'app installata
gui run <app> [argomenti]          # avvia nel terminale corrente
gui ask <app> [argomenti]          # stdout: solo il JSON passato a finish()
gui screen <app> [--keys 'K'] [--cols 100] [--rows 30] [argomenti] [-- argomenti]
gui check <app>                    # tipi + prova di avvio senza terminale
gui new <nome> [--dir D] [--from file.tsx] [--description T]
gui install [cartella] [--bin] | gui uninstall <nome> | gui ls [--json]
```

- **`gui run` e `gui ask` hanno bisogno di un terminale vero.** Dalla tua shell degli strumenti escono con 3 e il messaggio `nessun terminale`. Aprili in una finestra di Ghostty con ghostty-mcp (vedi "Mostrarla all'utente").
- **`gui ask`** scrive su stdout solo il JSON, quindi `risposta=$(gui ask form.tsx)` funziona come con fzf. Codici d'uscita:
  - 0 con una riga JSON;
  - 1 se l'app si chiude senza `finish()` (`q`, `:q`, `Ctrl-C`) o va in errore;
  - 2 per errori della CLI (app inesistente, nessun export di default);
  - 3 se non c'è un terminale.
  Controlla sempre il codice d'uscita, non solo il risultato.
- **`gui new <nome>`** crea la cartella `./<nome>`; con `--dir D` crea l'app direttamente in `D`, non in `D/<nome>`. Scrive `gui.json`, `app.tsx` e `tsconfig.json` e installa subito l'app. Non sovrascrive mai file esistenti. Il nome usa minuscole, cifre e trattini; i nomi dei sottocomandi (`run`, `ask`, `ls`...) sono rifiutati, così come un nome già installato da un'altra cartella.
- **`gui install --bin`** crea anche il comando `~/.local/bin/<nome>`; un `gui install` successivo senza `--bin` lo conserva. `gui uninstall` toglie l'app dal registro e quel comando, ma non cancella i file.
- **Registro:** è in `$GUI_HOME/registry.json`; senza `GUI_HOME` sta in `${XDG_DATA_HOME:-~/.local/share}/gui/registry.json`. Per prove che non devono toccare il registro vero usa `HOME=<tmp> GUI_HOME=<tmp>/gui gui ...`.

## Scrivere un'app

- Il file esporta di default il componente principale.
- Importa tutto da `'gui-kit'`:
  - i componenti della tabella sotto e anche `Overlay`, un riquadro centrato senza tasti;
  - `theme` e `rgb`;
  - gli hook `useFinish`, `useKeys`, `useCommand`, `useMouse`, `useKit`, `useKeymapState`;
  - da Ink: `Box`, `Text`, `Newline`, `Spacer`, `useWindowSize`;
  - da React: `useState`, `useEffect`, `useLayoutEffect`, `useRef`, `useMemo`, `useCallback`, `useReducer`, `useContext`, `createContext`, `Fragment`.
- Non importare `ink` direttamente: caricherebbe una seconda copia di Ink che legge il terminale sbagliato, e `gui check` fallisce. Da `react` puoi importare i tipi (`import type {ReactNode} from 'react'`).
- Avvolgi la schermata in `<Shell title="...">`. Lo Shell dà la barra di stato, la riga `:`, l'aiuto `?`, il menu dei tasti composti e `q` per uscire. `hint` sostituisce il testo a destra della barra (`? aiuto  : comandi  q esci`): se lo usi, ricorda `?` e `q`.
- Lo Shell mette i figli in colonna. `List`, `Table` e `Canvas` prendono tutto lo spazio rimasto. Se li metti dentro un tuo `Box`, dagli `flexGrow={1}`. Senza, una `List` mostra al massimo 10 righe, oppure quante ne chiedi con `height`.
- Per restituire un risultato prendi `const finish = useFinish()` nel corpo del componente e chiama `finish(valore)` in un gestore. L'app si chiude subito. Il valore deve essere serializzabile in JSON: usa `null`, non `undefined`.
- Gli argomenti dopo l'app arrivano in `process.env.GUI_ARGS` (array JSON); leggili con `JSON.parse(process.env.GUI_ARGS ?? '[]')`. La cartella dell'app è in `GUI_APP_DIR`; per un file singolo è la sua cartella. Vale per `gui <nome>`, `run`, `ask` e `screen`.
- Le funzioni passate a `useKeys`, `useCommand` e ai componenti vedono sempre lo stato attuale, non quello del primo disegno.
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

Due schermate, perché il kit non ha un componente per le schede:

```tsx
const [screen, setScreen] = useState<'lista' | 'grafico'>('lista');
const toggle = () => setScreen(current => (current === 'lista' ? 'grafico' : 'lista'));
useKeys([
	{keys: 'gt', desc: 'Schermata successiva', group: 'Schermate', run: toggle},
	{keys: 'gT', desc: 'Schermata precedente', group: 'Schermate', run: toggle},
]);
// poi: {screen === 'lista' ? <Elenco /> : <Grafico />}
```

La schermata nascosta viene smontata: tornandoci, cursore, filtro `/` e ordinamento ripartono da capo. Lo stato da conservare tienilo nel componente che sceglie la schermata.

## Componenti

| Componente | Uso |
|---|---|
| `List` | Elenco lungo. Props: `items`, `render(item, selected)`, `text(item)` (il testo per la ricerca), `onOpen`, `active`, `height`. Tasti: `j`/`k` o le frecce, `gg`/`G`, `Ctrl-d`/`Ctrl-u`, Invio apre. `/` filtra mentre scrivi: Invio tiene il filtro, `Esc` lo annulla, `/` seguito da Invio senza testo lo toglie. La rotella scorre; un clic seleziona e un secondo clic sulla riga evidenziata apre. |
| `Select` | Scegliere un'opzione. Props: `options` (`{label, value, hint?}[]`), `onSelect(value)`, `active`. `hint` compare in grigio accanto all'etichetta, e la ricerca `/` cerca anche lì. Stessi tasti e clic di `List`. |
| `Table` | Righe e colonne. Props: `columns`, `rows`, `onOpen`, `active`. Ogni colonna è `{key, title, width?, align?: 'left' \| 'right', format?: (valore, riga) => string}`, dove `valore` ha il tipo di quella chiave. Stessi tasti di `List`, più `s` (ordina per la colonna successiva) e `S` (inverte). |
| `Form` | Campi in colonna; vedi sotto. |
| `TextInput` | Una riga di testo. Props: `value`, `onChange`, `onSubmit`, `placeholder`, `active`. In modo normale le lettere sono comandi: `i`, `a` o Invio iniziano a scrivere, `cc` svuota e scrive. Mentre scrivi: Invio conferma e chiama `onSubmit`; `Esc` smette senza `onSubmit`; Backspace cancella; `Ctrl-u` svuota; `Ctrl-w` toglie una parola. Tab e frecce non fanno nulla, e si scrive sempre in fondo. |
| `Confirm` | Domanda sì/no. Props: `question`, `onAnswer(sì)`, `active`. `y` o Invio rispondono sì, `n` o `Esc` no. Finché è visibile prende tutti i tasti e i clic. |
| `Modal` | Finestra sopra la schermata. Props: `title`, `onClose`, `bindings` (tasti in più, gli stessi oggetti di `useKeys`). `q` ed `Esc` la chiudono. I componenti dentro ricevono tasti e clic, quindi un `Form` o un `Confirm` in un `Modal` funzionano. Finché è aperta non arrivano `:`, `?`, i tuoi comandi `:nome`, né i tasti e i clic della schermata sotto. |
| `Canvas` | Disegno; vedi "Grafica". |

**`Form`.**
- Ogni campo ha `name` e `label`, più il tipo:
  - `{type: 'text', placeholder?, default?}`;
  - `{type: 'select', options: string[], default?}`;
  - `{type: 'checkbox', default?}`.
- Props: `fields`, `onSubmit(valori)`, `submitLabel` (predefinito `Conferma`), `active`. `valori` è un oggetto `{nome: stringa o booleano}`.
- Il form invia anche con campi vuoti: la validazione tocca all'app.
- In modo normale:
  - `j`/`k`, Tab o le frecce cambiano campo;
  - `h`/`l` cambiano scelta, e dopo l'ultima ricominciano;
  - `x` o Invio spuntano una casella, passano alla scelta successiva o, sulla riga `Conferma`, inviano;
  - su un campo di testo Invio inizia a scrivere.
- Un campo di testo ha anche i comandi di `TextInput`: `i`, `a`, `cc`, e mentre scrivi `Ctrl-u` e `Ctrl-w`.
- Mentre scrivi, Invio conferma il campo e passa al successivo.
- `Ctrl-s` invia da qualsiasi campo, anche mentre scrivi.

## Tasti: stile Vim

- `:` apre la riga di comando: `:q` esce, `:help` mostra l'aiuto. `?` mostra l'aiuto con tutti i tasti attivi; non scorre, quindi in un terminale basso viene tagliato. `q` esce dall'app, oppure chiude l'aiuto o un `Modal`.
- `Esc` non esce dall'app. Annulla tasti in sospeso e conteggi, torna al modo normale dall'inserimento o dalla riga di comando, chiude aiuto e `Modal`, e in `Confirm` risponde no.
- I movimenti li danno i componenti, non lo Shell.
- **Conteggi.** Un conteggio (`5j`) arriva a `run(count)` di ogni tasto, ma lo usano solo `j`/`k` (di liste, tabelle e form), le frecce di `List`, `Select` e `Table`, e i tuoi tasti che leggono `count`: `5G` va comunque all'ultima riga. Una cifra è un conteggio, a meno che l'app non abbia un tasto che inizia con quella cifra: allora `1` è un tasto, e un conteggio non può più cominciare con `1`. Mentre scrivi o nel filtro `/` le cifre sono testo.
- **Tasti composti.** Un tasto che è anche l'inizio di un altro (`g` quando esistono `g` e `gt`) scatta dopo 700 ms, oppure subito se arriva un tasto diverso, che poi conta da solo. Un prefisso che da solo non è un comando aspetta il tasto successivo. `Esc` annulla.
- `Spazio` non fa nulla da solo. Usalo come prefisso per i tasti della tua app (`<Space>1`, `<Space>f`): il menu dei tasti composti li mostra.
- **Aggiungere tasti:** `useKeys([{keys: 'dd', desc: 'Elimina', group: 'Lista', mode?: 'normal' | 'insert', run: count => ...}], {active, modal, priority, onText})`.
  - La notazione è quella di Vim (`gg`, `<C-d>`, `<Space>x`), con questi nomi esatti: `<CR>`, `<Esc>`, `<Tab>`, `<S-Tab>`, `<BS>`, `<Del>`, `<Up>`, `<Down>`, `<Left>`, `<Right>`, `<PageUp>`, `<PageDown>`, `<Home>`, `<End>`, `<Space>`, `<C-x>` con la lettera minuscola e `<M-x>`. Un nome diverso (`<Enter>`, `<C-D>`) ferma l'app con l'errore `Tasto sconosciuto`, che `gui check` mostra.
  - `desc` e `group` sono in italiano e compaiono nell'aiuto; `group: 'hidden'` li nasconde.
  - Vince la priorità più alta; a parità vince la chiamata a `useKeys` registrata per ultima (non il `group`). I valori: Shell -10, normale 0, `modal: true` 10, aiuto 1000; dentro un `Modal` tutto sale di 20.
  - Un componente si registra di nuovo quando cambiano i suoi tasti o `active` (il `Form` ogni volta che inizi o smetti di scrivere), quindi a parità di priorità il vincitore cambia durante l'uso. Per i tuoi tasti non usare quelli dei componenti attivi: `j`, `k`, `h`, `l`, `x`, `s`, `S`, `i`, `a`, `cc`, `/` e Invio.
  - `modal: true` nasconde tutto quello che ha priorità più bassa.
  - In modo `'insert'` scattano solo tasti singoli con nome (`<C-s>`, `<CR>`, `<Tab>`...). Lettere e cifre finiscono sempre nel testo, e le sequenze non scattano. `<Esc>` in modo `'insert'` non scatta mai, perché torna sempre al modo normale. L'aiuto `?` mostra solo i tasti del modo normale.
- **Comandi `:nome`:** `useCommand('nome', 'descrizione', argomenti => ...)`. `argomenti` è una stringa (il resto della riga), non un array. Mentre è aperto un `Modal` o un `Confirm`, `:` non arriva.
- Non ridefinire `:`, `?` e `q` a livello di app; un `Modal` invece li usa per chiudersi.
- Tieni attivo un solo componente con `j`/`k` alla volta (`List`, `Select`, `Table`, `Form`), usando `active`: si contendono gli stessi tasti, e la ricerca `/` ha un solo destinatario.

## Stile

- Colori solo da `theme`, mai valori fissi. I colori disponibili sono `background`, `text`, `muted`, `accent`, `accentText` (testo su `accent`), `border`, `selection`, `success`, `warning`, `danger`, e `modes.normal`, `modes.insert`, `modes.command`. Per il `Canvas` convertili con `rgb(theme.accent)`.
- Testi dell'interfaccia in italiano e brevi. In cima a ogni schermata metti una riga che dice cosa si può fare.
- Niente finestre o pannelli multipli dentro l'app: per una seconda vista usa una schermata o un `Modal`.

## Grafica

**`Canvas`.**
- Props obbligatorie:
  - `backend`: `'braille'`, `'half'` o `'kitty'`;
  - `version`: un numero da incrementare a ogni cambio della scena;
  - `draw(raster, {sx, sy})`.
- Si ridisegna solo quando cambiano `version`, la dimensione o `backend`.
- Prende tutto lo spazio rimasto nel contenitore.
- Facoltative:
  - `background`: un colore RGB; il predefinito `[250, 250, 245]` è quasi bianco, quindi per uno sfondo scuro passa `rgb(theme.background)`;
  - `onPointer`;
  - `onFrame(ms, byte)`.

**`Raster`.**
- `raster.width` e `raster.height` sono in pixel del raster; `sx` e `sy` sono i pixel per cella: 2×4 col braille, 1×2 con `'half'`, fino a 10×20 con kitty.
- Metodi:
  - `plot(x, y, c)`;
  - `dot(cx, cy, r, c)`;
  - `line`, `rect` ed `ellipse`, con `(x0, y0, x1, y1, spessore, c)`;
  - `clear()`.
- `spessore` è il raggio del pennello: con 0 disegna un pixel. `rect` ed `ellipse` disegnano solo il contorno; per riempire un'area disegna linee affiancate.
- `draw` riceve ogni volta un raster nuovo e già pulito, quindi `clear()` non serve. Il tipo `Raster` si importa da `'gui-kit'`.
- I colori sono terne `[r, g, b]`.

**`onPointer`.**
- Riceve `{kind: 'down' | 'up' | 'drag' | 'wheel', button, wheel?: 'up' | 'down', x, y}`.
- `x` e `y` sono in celle dall'angolo del canvas: con il mouse a pixel hanno decimali veri, altrimenti valgono il centro della cella.
- Nel raster diventano `x * sx`, `y * sy`. `onPointer` non riceve `sx` e `sy`: salvali in un `useRef` dentro `draw` (`scala.current = {sx, sy}`).
- Mentre è aperto un `Modal` o un `Confirm`, `onPointer` non riceve clic.

**Resa.**
- Usa `backend="braille"` (o `'half'`): funziona in ogni terminale, anche in tmux e ssh.
- I pixel veri (grafica kitty) servono solo se l'utente li vuole: passa `backend={caps.graphics === 'kitty' ? 'kitty' : 'braille'}`. `caps.graphics` vale `'kitty'` solo con `GUI_GRAPHICS=kitty`, un terminale che risponde alla query kitty e fuori da tmux. In tutti gli altri casi il `Canvas` torna da solo al braille.
- Il kit invia le immagini in PNG e non deve mai usare `o=z`. Ghostty 1.3.1 va in crash su stream zlib a Huffman fisso, e il crash chiude tutte le schede dell'utente (`~/Documents/AiAgents/lab/gui-kit/bench/ghostty-zlib-crash.md`).
- Le novità grafiche si provano solo in un'istanza separata di Ghostty (`open -na Ghostty.app --args --window-save-state=never`), mai nella Ghostty dell'utente.

## Verificare prima di consegnare

1. **`gui check app.tsx`** deve stampare `tipi ok` e `si avvia e si disegna`. La seconda prova dura circa 100 ms e non preme tasti: non trova gli errori che arrivano dopo o premendo un tasto, né un layout sbagliato. Per quelli serve `gui screen`.
2. **`gui screen app.tsx --keys '...'`** stampa lo schermo dopo i tasti.
   - I tasti si scrivono con gli stessi nomi di `useKeys`: `5j`, `/cerca<CR>`, `<Esc>`, `<C-s>`, `<S-Tab>`, `<Space>`. Mentre scrivi in un campo, uno spazio normale è uno spazio. Un nome che non conosce lo fa uscire con 2.
   - Stampa solo testo, senza colori: una riga selezionata, un segnaposto o un colore non si vedono. Controlla il testo, e se serve aggiungi un segno visibile (un contorno, un `▌`).
   - Prova i tasti principali, un campo con spazi, `?` e `q`.
   - Dopo lo schermo stampa `[finish] <json>` se l'app ha chiamato `finish()`, oppure `[uscita]` se si è chiusa senza. In entrambi i casi lo schermo è l'ultimo frame prima dell'uscita e il codice d'uscita è 0, quindi guarda l'output.
   - Gli argomenti per l'app vanno dopo il nome dell'app; quelli dopo `--` arrivano tali e quali, anche se somigliano alle opzioni di `gui screen`.
   - Se l'app va in errore, esce con 1 e scrive `[errore]` e lo stack su stderr. Se l'errore è nel disegno, al posto dell'app compare il riquadro d'errore di Ink.
   - Senza export di default esce con 2.
3. **Limiti di `gui screen`:**
   - niente mouse;
   - aspetta circa 130 ms dopo l'ultimo tasto (200 ms dopo `Esc`): quello che succede dopo non si vede;
   - non terminare `--keys` con un prefisso, perché scatterebbe solo dopo 700 ms.
4. **Mostrarla all'utente** con ghostty-mcp:
   - `open_terminal` con `where: "window"` o `"tab"`;
   - `send_text` con `gui <nome>`, oppure `gui ask file.tsx > risposta.json; echo "uscita=$?"`;
   - per pilotarla tu: `send_keys` per i tasti con nome (`esc`, `enter`, `ctrl+s`) e `send_text` con `mode: "type"` e `submit: false` per il testo (senza `submit: false` preme anche Invio);
   - `read_screen` o `wait_for` per controllare;
   - alla fine leggi il file e il codice d'uscita.
5. **Riporta cosa hai verificato e come:** senza terminale, dal vivo, o non verificato.
