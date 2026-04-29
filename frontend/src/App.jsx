import { useEffect, useState } from 'react'
import { Button, Group, Paper, SimpleGrid, Stack, Text, Title } from '@mantine/core'
import { IconRadar2, IconWind } from '@tabler/icons-react'
import DispatcherPage from './features/dispatcher/ui/DispatcherPage'
import MeteorologistPage from './features/dispatcher/ui/MeteorologistPage'
import MeteorologistRequestPage from './features/dispatcher/ui/MeteorologistRequestPage'

const ROLE_STORAGE_KEY = 'dispatcher-app-role'

function readStoredRole() {
  const savedRole = window.localStorage.getItem(ROLE_STORAGE_KEY)
  if (savedRole === 'dispatcher' || savedRole === 'meteorologist') {
    return savedRole
  }
  return null
}

function writeStoredRole(role) {
  if (!role) {
    window.localStorage.removeItem(ROLE_STORAGE_KEY)
    return
  }
  window.localStorage.setItem(ROLE_STORAGE_KEY, role)
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
    tab: tab === 'flights' ? 'flights' : 'monitoring',
    prefill: null,
  }
}

function navigateToDispatcher(tab = 'monitoring') {
  if (tab === 'flights') {
    window.location.hash = '/?tab=flights'
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

function RoleChoiceScreen({ onChooseRole }) {
  return (
    <Paper withBorder radius="xl" p="xl" className="surface-card" maw={900} mx="auto">
      <Stack gap="md">
        <Title order={2}>Выберите роль</Title>
        <Text c="dimmed">
          Интерфейс и доступные кнопки будут показаны в зависимости от выбранной роли.
        </Text>
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
          <Button
            size="lg"
            radius="xl"
            variant="filled"
            leftSection={<IconRadar2 size={18} />}
            onClick={() => onChooseRole('dispatcher')}
          >
            Диспетчер
          </Button>
          <Button
            size="lg"
            radius="xl"
            variant="light"
            color="teal"
            leftSection={<IconWind size={18} />}
            onClick={() => onChooseRole('meteorologist')}
          >
            Метеоролог
          </Button>
        </SimpleGrid>
      </Stack>
    </Paper>
  )
}

function App() {
  const [route, setRoute] = useState(() => readHashRoute())
  const [role, setRole] = useState(() => readStoredRole())

  useEffect(() => {
    const handleHashChange = () => {
      setRoute(readHashRoute())
    }

    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  useEffect(() => {
    if (!window.location.hash && role === 'dispatcher') {
      navigateToDispatcher()
    }
  }, [role])

  const handleChooseRole = (nextRole) => {
    setRole(nextRole)
    writeStoredRole(nextRole)

    if (nextRole === 'dispatcher') {
      navigateToDispatcher()
    } else {
      window.location.hash = '/'
    }
  }

  const handleResetRole = () => {
    setRole(null)
    writeStoredRole(null)
    window.location.hash = '/'
  }

  if (!role) {
    return <RoleChoiceScreen onChooseRole={handleChooseRole} />
  }

  if (role === 'meteorologist') {
    return (
      <Stack gap="md">
        <Group justify="space-between" wrap="wrap">
          <Title order={3}>Роль: метеоролог</Title>
          <Button variant="default" radius="xl" onClick={handleResetRole}>
            Сменить роль
          </Button>
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
          <Button variant="default" radius="xl" onClick={handleResetRole}>
            Сменить роль
          </Button>
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
        <Button variant="default" radius="xl" onClick={handleResetRole}>
          Сменить роль
        </Button>
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
