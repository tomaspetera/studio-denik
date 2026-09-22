"use client";

import { useEffect, useState } from "react";
import { subscribePushAction, unsubscribePushAction } from "./push-actions";
import styles from "./shell.module.css";

/**
 * Zapnutí/vypnutí upozornění na tomhle zařízení. Kalendářní odběr (viz
 * Kalendář) umí termíny dostat do telefonu, ale spolehlivé upozornění
 * přesně v čas neumí — Google u odebíraných kalendářů budíky schválně
 * ignoruje. Tohle je ta chybějící část.
 *
 * Bez nastaveného veřejného VAPID klíče se tlačítko vůbec nezobrazí —
 * server bez něj stejně nemá jak odeslat.
 */
export default function PushSetup() {
  const [supported, setSupported] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!publicKey || !("serviceWorker" in navigator) || !("PushManager" in window)) return;

    // `setSupported` schválně nevolám hned v těle efektu, jen naplánuju
    // slib — jinak by to ESLint právem hlásil jako zbytečný extra
    // vykreslovací cyklus (react-hooks/set-state-in-effect).
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        setSupported(true);
        return reg.pushManager.getSubscription();
      })
      .then((sub) => setSubscribed(Boolean(sub)))
      .catch(() => {});
  }, []);

  async function enable() {
    setError(null);
    setBusy(true);
    try {
      const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!publicKey) return;

      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setError("Bez povolení v prohlížeči to nepůjde.");
        return;
      }

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      const json = sub.toJSON();
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
        setError("Prohlížeč vrátil neúplný odběr.");
        return;
      }

      const res = await subscribePushAction({
        endpoint: json.endpoint,
        p256dh: json.keys.p256dh,
        auth: json.keys.auth,
      });
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setSubscribed(true);
    } catch {
      setError("Nepodařilo se to zapnout.");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setError(null);
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await unsubscribePushAction(sub.endpoint);
        await sub.unsubscribe();
      }
      setSubscribed(false);
    } catch {
      setError("Nepodařilo se to vypnout.");
    } finally {
      setBusy(false);
    }
  }

  if (!supported) return null;

  return (
    <span className={styles.pushWrap}>
      <button
        type="button"
        className={`btn btn-ghost ${styles.themeBtn} ${subscribed ? styles.pushOn : ""}`}
        onClick={subscribed ? disable : enable}
        disabled={busy}
        aria-label={subscribed ? "Vypnout upozornění na tomhle zařízení" : "Zapnout upozornění na termíny"}
        title={subscribed ? "Upozornění na tomhle zařízení jsou zapnutá" : "Ranní souhrn a upozornění na termíny přímo do telefonu"}
      >
        <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 01-3.46 0" />
        </svg>
      </button>
      {error && <em className={styles.pushError}>{error}</em>}
    </span>
  );
}

/**
 * VAPID klíč přichází jako base64url — Push API chce Uint8Array.
 *
 * `Uint8Array.from(...)` vrací typ nad obecným `ArrayBufferLike`, který
 * novější typy DOM knihovny (`BufferSource`) nepřijmou — proto pole plníme
 * ručně do bufferu, který je vždy přesně `ArrayBuffer`.
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
