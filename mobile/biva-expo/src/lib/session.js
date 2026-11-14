// Sessão: quem está a usar a app. Ao abrir, confirma o token guardado com a API.
import { createContext, createElement, useCallback, useContext, useEffect, useState } from "react";
import { api, clearToken, readToken, saveToken } from "./api";

const SessionContext = createContext(null);

export function SessionProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

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

  // code: só quando a conta tem verificação em dois passos (a API responde twoFactorRequired).
  const signIn = async (email, password, code) => {
    const result = await api("/auth/login", { method: "POST", body: { email, password, ...(code ? { code } : {}) } });
    await saveToken(result.token);
    setUser(result.user);
  };
  const signOut = async () => {
    await clearToken();
    setUser(null);
  };

  return createElement(SessionContext.Provider, { value: { user, ready, signIn, signOut, refresh } }, children);
}

export const useSession = () => useContext(SessionContext);
