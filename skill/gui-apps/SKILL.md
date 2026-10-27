---
name: gui-apps
description: "Creare, avviare e gestire app da terminale fatte con gui-kit (Ink 8): app al volo per chiedere qualcosa all'utente (gui ask, risposta in JSON) e app complete salvate e installate per nome (gui <app>). Usare quando l'utente chiede un'interfaccia, un form, una scelta, una tabella o un canvas nel terminale, oppure di aprire, installare o disinstallare una di queste app."
---

# App da terminale con gui-kit

Ogni app occupa a schermo intero il terminale in cui parte e non gestisce finestre. I terminali li gestisce l'utente in Ghostty, oppure tu con ghostty-mcp. Il kit e la CLI stanno in `~/Documents/AiAgents/lab/gui-kit`; il comando è `gui` (`~/.local/bin/gui`).

## Scegliere il tipo di app

- **Al volo:** un solo file `.tsx` scritto dove serve (per esempio nello scratchpad). Si usa una volta e non si installa. Serve per chiedere all'utente una scelta, i campi di un form o una conferma.
- **Salvata:** una cartella con `gui.json` e `app.tsx`, installata col suo nome. Si crea con `gui new <nome> [--dir D] [--description T]`, oppure da un file al volo con `gui new <nome> --from file.tsx`.

## Comandi

```sh
gui <app> [argomenti]              # avvia un'app installata
gui run <app|cartella|file>        # avvia nel terminale corrente
gui ask <app|file>                 # risultato di finish() in JSON su stdout; uscita 1 se annullata
gui screen <file|app> --keys 'K' [--cols 100 --rows 30]   # prova senza terminale
gui check <file|app>               # controllo dei tipi
gui new <nome> | gui install [cartella] [--bin] | gui uninstall <nome> | gui ls [--json]
```

`gui ask` disegna sul terminale e scrive su stdout solo il JSON, quindi `risposta=$(gui ask form.tsx)` funziona come con fzf. `uninstall` toglie l'app dal registro e il comando creato con `--bin`, ma non cancella i file.

## Scrivere un'app

- Il file esporta di default il componente principale e importa tutto da `'gui-kit'`: componenti del kit, `Box`, `Text`, `useState`, `useEffect`... Non importare `react` o `ink` direttamente.
- Avvolgi sempre la schermata in `<Shell title="...">`. Lo Shell dà barra di stato, riga `:`, aiuto `?`, menu dei tasti composti e `q` per uscire.
- Per restituire un risultato chiama `useFinish()(valore)`. Il valore deve essere serializzabile in JSON.
- Gli argomenti dopo il nome dell'app arrivano in `process.env.GUI_ARGS` (array JSON). La cartella dell'app è in `GUI_APP_DIR`.

```tsx
import {Form, Shell, useFinish} from 'gui-kit';

export default function App() {
	const finish = useFinish();
	return (
		<Shell title="Nuovo cliente">
			<Form
				fields={[
					{name: 'nome', label: 'Nome', type: 'text'},
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
| `Shell` | Cornice di ogni app. |
| `List` | Elenco lungo: `j/k`, `gg/G`, `Ctrl-d/u`, ricerca `/`, rotella e clic. |
| `Select` | Scegliere un'opzione (`{label, value, hint}`); Invio o clic sceglie. |
| `Table` | Righe e colonne; `s` ordina per la colonna successiva, `S` inverte l'ordine. |
| `Form` | Campi `text`, `select`, `checkbox`; `Ctrl-s` invia. |
| `TextInput` | Una riga di testo: `i` per scrivere, `Esc` per finire. |
| `Confirm` | Domanda sì/no (`y`/`n`). |
| `Modal` | Finestra sopra la schermata; prende i tasti finché è aperta. |
| `Canvas` | Disegno vettoriale reso in braille o mezzi blocchi; `draw(raster, scale)` più `onPointer`. |

## Tasti: stile Vim, uguali in ogni app

- Movimento con `h j k l`, `gg`/`G`, `Ctrl-d`/`Ctrl-u` e conteggi (`5j`). `/` cerca. `:` apre la riga di comando. `?` mostra l'aiuto. `Spazio` è il tasto leader. `q` e `Esc` chiudono.
- I tasti propri si aggiungono con `useKeys([{keys: 'dd', desc: 'Elimina', group: 'Lista', run}])`. `desc` e `group` sono in italiano e compaiono nell'aiuto; `group: 'hidden'` li nasconde.
- I comandi `:nome` si aggiungono con `useCommand('nome', 'descrizione', run)`.
- Non ridefinire `:`, `?` e `q` a livello di app. Una finestra modale sì, può usare `q` ed `Esc` per chiudersi.

## Stile

- Colori solo da `theme` (`theme.accent`, `theme.muted`...), mai valori fissi.
- Testi dell'interfaccia in italiano, brevi. Ogni schermata ha in alto una riga che dice cosa si può fare.
- Niente gestione di finestre o pannelli multipli dentro l'app: per una seconda vista usa una schermata (`gt`/`gT`, `Spazio 1/2`) o un `Modal`.

## Grafica

- Il canvas usa il braille per default e funziona in ogni terminale, anche tmux e ssh.
- I pixel veri (grafica kitty) si attivano solo con `GUI_GRAPHICS=kitty`. Il kit invia PNG: non usare mai `o=z`, perché manda in crash Ghostty 1.3.1 (`bench/ghostty-zlib-crash.md`). Un crash di Ghostty chiude tutte le schede dell'utente, quindi prova le novità grafiche solo in un'istanza separata (`open -na Ghostty.app --args --window-save-state=never`) o in tmux.

## Verificare prima di consegnare

1. `gui check app.tsx` deve dire `tipi ok`.
2. `gui screen app.tsx --keys '...'` deve mostrare lo schermo atteso. Con `finish` stampa anche `[finish] <json>`. Prova i tasti principali, `?` e `q`.
3. Per mostrarla all'utente, aprila in Ghostty con ghostty-mcp: `open_terminal`, poi `send_text` con `gui <app>` (o `gui ask file.tsx > risposta.json`), `read_screen` per controllare, e alla fine leggi il file della risposta.
4. Riporta cosa hai verificato e come: headless, dal vivo o non verificato.
