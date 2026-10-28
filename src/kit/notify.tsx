// Notifications: short messages that Shell draws at the top right. The state
// lives in KitProvider, so useNotify also works in the app component that
// renders the Shell. Two contexts, so calling notify() re-renders only the
// toasts, not every component that holds the function.

import {createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode} from 'react';

export type NotifyKind = 'info' | 'success' | 'warning' | 'error';

export type NotifyOptions = {
	kind?: NotifyKind;
	/** Milliseconds before it goes away; 0 keeps it until dismissed. Errors default to 0, the rest to 4000. */
	timeout?: number;
};

export type Toast = {id: number; text: string; kind: NotifyKind};

type Notify = (text: string, options?: NotifyOptions) => void;

const NotifyContext = createContext<Notify | undefined>(undefined);
const ToastsContext = createContext<{toasts: Toast[]; dismiss: (id?: number) => void}>({toasts: [], dismiss: () => {}});

const MAX_TOASTS = 5;

export function NotifyProvider({children}: {children: ReactNode}) {
	const [toasts, setToasts] = useState<Toast[]>([]);
	const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
	const nextId = useRef(1);

	/** Removes one toast, or all of them without an id. */
	const dismiss = useCallback((id?: number) => {
		for (const [key, timer] of timers.current) {
			if (id === undefined || key === id) {
				clearTimeout(timer);
				timers.current.delete(key);
			}
		}
		setToasts(current => (id === undefined ? [] : current.filter(toast => toast.id !== id)));
	}, []);

	const notify = useCallback<Notify>((text, {kind = 'info', timeout} = {}) => {
		const id = nextId.current++;
		setToasts(current => [...current, {id, text, kind}].slice(-MAX_TOASTS));
		const ms = timeout ?? (kind === 'error' ? 0 : 4000);
		if (ms > 0) timers.current.set(id, setTimeout(() => dismiss(id), ms));
	}, [dismiss]);

	useEffect(() => () => {
		for (const timer of timers.current.values()) clearTimeout(timer);
	}, []);

	return (
		<NotifyContext.Provider value={notify}>
			<ToastsContext.Provider value={{toasts, dismiss}}>{children}</ToastsContext.Provider>
		</NotifyContext.Provider>
	);
}

/** `notify(text, {kind, timeout})` shows a toast at the top right of the Shell. */
export function useNotify(): Notify {
	const notify = useContext(NotifyContext);
	if (!notify) {
		throw new Error('useNotify needs <KitProvider>');
	}
	return notify;
}

/** The open toasts, for the Shell that draws them. */
export function useToasts() {
	return useContext(ToastsContext);
}
