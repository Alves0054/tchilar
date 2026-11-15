// Sessão: quem está a usar a app. Ao abrir, confirma o token guardado com a API.
import { createContext, createElement, useCallback, useContext, useEffect, useState } from "react";
import { api, clearToken, onSessionExpired, readToken, saveToken } from "./api";
import { registerForPush, unregisterPush } from "./push";

const SessionContext = createContext(null);

export function SessionProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [expiredNotice, setExpiredNotice] = useState("");

  const refresh = useCallback(async () => {
    try {
      if (!(await readToken())) return setUser(null);
      setUser((await api("/auth/me")).user);
    } catch (error) {
      // Sessão expirada, conta suspensa ou apagada: volta ao ecrã de entrada.
      if ([401, 403, 404].includes(error.status)) {
        await clearToken();
        setUser(null);
      }
    } finally {
      setReady(true);
    }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  // As sessões não expiram. Só acabam se forem terminadas (noutro dispositivo, mudança de palavra-passe,
  // conta suspensa): nesse caso, volta ao ecrã de entrar com uma mensagem.
  useEffect(() => {
    onSessionExpired(() => { setUser(null); setExpiredNotice("A tua sessão terminou. Entra outra vez."); });
    return () => onSessionExpired(null);
  }, []);
  // Com sessão iniciada, regista este telemóvel para notificações push (pede autorização uma vez).
  useEffect(() => {
    if (user?.id) registerForPush().catch(() => {});
  }, [user?.id]);

  // code: só quando a conta tem verificação em dois passos (a API responde twoFactorRequired).
  const signIn = async (email, password, code) => {
    // client "app": marca a sessão como vinda da app.
    const result = await api("/auth/login", { method: "POST", body: { email, password, client: "app", ...(code ? { code } : {}) } });
    await saveToken(result.token);
    setExpiredNotice("");
    setUser(result.user);
  };
  const signOut = async () => {
    await unregisterPush();
    // Termina a sessão no servidor: o token deixa de valer, mesmo que tenha ficado copiado algures.
    await api("/auth/logout", { method: "POST" }).catch(() => {});
    await clearToken();
    setUser(null);
  };

  return createElement(SessionContext.Provider, { value: { user, ready, signIn, signOut, refresh, expiredNotice } }, children);
}

export const useSession = () => useContext(SessionContext);
