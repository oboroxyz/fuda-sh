import type { JSX } from 'solid-js'

import { Settings } from '../../src/member/Settings.tsx'
import { usePreferences, useSignOut } from '../../src/page-context.tsx'

export default function SettingsPage(): JSX.Element {
  const preferences = usePreferences()
  const signOut = useSignOut()
  return (
    <Settings
      locale={preferences.locale()}
      onLocaleChange={preferences.setLocale}
      onSignOut={signOut}
      onThemeChange={preferences.setTheme}
      theme={preferences.theme()}
    />
  )
}
