import { useEffect, useState } from 'react'
import { Button, Group, Paper, SegmentedControl, Stack, Title } from '@mantine/core'
import DispatcherPage from './features/dispatcher/ui/DispatcherPage'
import MeteorologistPage from './features/dispatcher/ui/MeteorologistPage'
import MeteorologistRequestPage from './features/dispatcher/ui/MeteorologistRequestPage'

const SESSION_STORAGE_KEY = 'dispatcher-app-session'

function readSession() {
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function writeSession(session) {
  if (!session) {
    window.localStorage.removeItem(SESSION_STORAGE_KEY)
    return
  }
  window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session))
}

function readHashRoute() {
  const hashValue = window.location.hash.startsWith('#')
    ? window.location.hash.slice(1)
    : window.location.hash
  const routeValue = hashValue || '/'
  const [path, rawQuery = ''] = routeValue.split('?')

  if (path === '/meteorologist-request') {
    const params = new URLSearchParams(rawQuery)
    return {
      page: 'meteorologist-request',
      prefill: {
        flightNumber: params.get('flightNumber') ?? '',
        fromAirportId: params.get('fromAirportId') ?? '',
        toAirportId: params.get('toAirportId') ?? '',
        etd: params.get('etd') ?? '',
        eta: params.get('eta') ?? '',
      },
    }
  }

  const params = new URLSearchParams(rawQuery)
  const tab = params.get('tab')

  return {
    page: 'dispatcher',
    tab: tab === 'flights' || tab === 'analytics' ? tab : 'monitoring',
    prefill: null,
  }
}

function navigateToDispatcher(tab = 'monitoring') {
  if (tab === 'flights') {
    window.location.hash = '/?tab=flights'
    return
  }
  if (tab === 'analytics') {
    window.location.hash = '/?tab=analytics'
    return
  }
  window.location.hash = '/'
}

function navigateToMeteorologistRequest(prefill) {
  const params = new URLSearchParams()

  if (prefill?.flightNumber) params.set('flightNumber', prefill.flightNumber)
  if (prefill?.fromAirportId) params.set('fromAirportId', prefill.fromAirportId)
  if (prefill?.toAirportId) params.set('toAirportId', prefill.toAirportId)
  if (prefill?.etd) params.set('etd', prefill.etd)
  if (prefill?.eta) params.set('eta', prefill.eta)

  const query = params.toString()
  window.location.hash = query ? `/meteorologist-request?${query}` : '/meteorologist-request'
}

function AuthScreen({ onAuthenticated }) {
  const [role, setRole] = useState('dispatcher')

  const handleSubmit = () => {
    const normalizedRole = role === 'meteorologist' ? 'meteorologist' : 'dispatcher'
    const session = {
      login: normalizedRole,
      name: normalizedRole === 'meteorologist' ? 'Метеоролог' : 'Диспетчер',
      role: normalizedRole,
      loggedAt: new Date().toISOString(),
    }
    writeSession(session)
    onAuthenticated(session)
  }

  return (
    <Paper withBorder radius="xl" p="xl" className="surface-card" maw={560} mx="auto">
      <Stack gap="md">
        <Title order={2}>Быстрый вход</Title>
        <SegmentedControl
          value={role}
          onChange={setRole}
          data={[
            { value: 'dispatcher', label: 'Диспетчер' },
            { value: 'meteorologist', label: 'Метеоролог' },
          ]}
        />
        <Button radius="xl" onClick={handleSubmit}>
          Войти
        </Button>
      </Stack>
    </Paper>
  )
}

function App() {
  const [route, setRoute] = useState(() => readHashRoute())
  const [session, setSession] = useState(() => readSession())

  useEffect(() => {
    const handleHashChange = () => setRoute(readHashRoute())
    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  const handleLogout = () => {
    setSession(null)
    writeSession(null)
    window.location.hash = '/'
  }

  if (!session) {
    return <AuthScreen onAuthenticated={setSession} />
  }

  if (session.role === 'meteorologist') {
    return (
      <Stack gap="md">
        <Group justify="space-between" wrap="wrap">
          <Title order={3}>Метеоролог ({session?.name || session?.login})</Title>
          <Button variant="light" radius="xl" color="red" onClick={handleLogout}>Выйти</Button>
        </Group>
        <MeteorologistPage />
      </Stack>
    )
  }

  if (route.page === 'meteorologist-request') {
    const prefillKey = [
      route.prefill?.flightNumber ?? '',
      route.prefill?.fromAirportId ?? '',
      route.prefill?.toAirportId ?? '',
      route.prefill?.etd ?? '',
      route.prefill?.eta ?? '',
    ].join('|')

    return (
      <Stack gap="md">
        <Group justify="flex-end" wrap="wrap">
          <Button variant="light" radius="xl" color="red" onClick={handleLogout}>Выйти</Button>
        </Group>
        <MeteorologistRequestPage
          key={prefillKey}
          initialValues={route.prefill}
          onBack={() => navigateToDispatcher('flights')}
          onSent={() => navigateToDispatcher()}
        />
      </Stack>
    )
  }

  return (
    <Stack gap="md">
      <Group justify="flex-end" wrap="wrap">
        <Button variant="light" radius="xl" color="red" onClick={handleLogout}>Выйти</Button>
      </Group>
      <DispatcherPage
        key={`dispatcher-${route.tab ?? 'monitoring'}`}
        initialTab={route.tab}
        onRequestMeteorologist={navigateToMeteorologistRequest}
      />
    </Stack>
  )
}

export default App
