// Por onde podem ir os códigos de confirmação (SMS e/ou WhatsApp, pela ordem do servidor; igual ao site).
import { useEffect, useState } from "react";
import { api } from "./api";

export const SMS_CHANNEL_LABELS = { sms: "SMS", whatsapp: "WhatsApp" };
let cache = null;

export function useSmsChannels() {
  const [channels, setChannels] = useState(cache || ["sms"]);
  useEffect(() => {
    if (cache) return undefined;
    let alive = true;
    api("/auth/phone/channels").then(result => {
      cache = result.channels?.length ? result.channels : ["sms"];
      if (alive) setChannels(cache);
    }).catch(() => {});
    return () => { alive = false; };
  }, []);
  return channels;
}
