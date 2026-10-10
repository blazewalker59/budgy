/**
 * Budgy as an installed app (a PWA, as sportsline): the service worker is
 * registered once the page has loaded, and installing is offered where the
 * browser allows it (Chrome, Edge, Android) or explained (iOS Safari, where
 * it's Share → Add to Home Screen).
 */

import { useEffect, useState } from 'react'

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

function isIos(): boolean {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
}

/** Register /sw.js after load (production builds only). */
export function useServiceWorker(): void {
  useEffect(() => {
    if (import.meta.env.DEV || !('serviceWorker' in navigator)) return
    const register = () =>
      void navigator.serviceWorker.register('/sw.js').catch(() => {
        // Not installable then; the site works the same.
      })
    if (document.readyState === 'complete') register()
    else window.addEventListener('load', register, { once: true })
  }, [])
}

export type Install =
  { kind: 'prompt'; install: () => void } | { kind: 'ios' } | { kind: 'none' }

/** How (or whether) this browser can install Budgy right now. */
export function useInstall(): Install {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null)
  const [state, setState] = useState<'none' | 'ios' | 'prompt'>('none')
  useEffect(() => {
    if (isStandalone()) return
    if (isIos()) setState('ios')
    const onPrompt = (e: Event) => {
      e.preventDefault()
      setPrompt(e as InstallPromptEvent)
      setState('prompt')
    }
    const onInstalled = () => setState('none')
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])
  if (state === 'prompt' && prompt)
    return {
      kind: 'prompt',
      install: () => {
        void prompt.prompt()
        void prompt.userChoice.then(() => setState('none'))
      },
    }
  return state === 'ios' ? { kind: 'ios' } : { kind: 'none' }
}
