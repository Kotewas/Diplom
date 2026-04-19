import { useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Checkbox,
  Group,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Textarea,
  Title,
} from '@mantine/core'
import { IconCheck, IconChevronLeft } from '@tabler/icons-react'
import {
  DEFAULT_METEOROLOGIST_NEEDS,
  METEOROLOGIST_NEEDS,
} from '../model/meteorologistNeeds'
import { saveActiveMeteorologistRequest } from '../services/meteorologistRequestsStorage'
import './MeteorologistRequestPage.css'

function createInitialForm(initialValues) {
  return {
    flightNumber: initialValues?.flightNumber ?? '',
    fromAirportId: initialValues?.fromAirportId ?? '',
    toAirportId: initialValues?.toAirportId ?? '',
    etd: initialValues?.etd ?? '',
    eta: initialValues?.eta ?? '',
    dispatcherComment: '',
  }
}

function buildRequestMessage(form, needs) {
  const selectedNeeds = METEOROLOGIST_NEEDS.filter((item) => needs[item.key]).map(
    (item) => `- ${item.label}`,
  )

  const lines = [
    `Номер рейса: ${form.flightNumber || 'не указан'}`,
    `Аэропорт вылета: ${form.fromAirportId || 'не указан'}`,
    `Аэропорт назначения: ${form.toAirportId || 'не указан'}`,
    `Плановое время вылета (ETD): ${form.etd || 'не указано'}`,
    `Плановое время прилета (ETA): ${form.eta || 'не указано'}`,
    '',
    'Что требуется от метеоролога:',
    ...(selectedNeeds.length > 0 ? selectedNeeds : ['- Уточнить погодные условия по рейсу']),
  ]

  if (form.dispatcherComment.trim()) {
    lines.push('')
    lines.push(`Комментарий диспетчера: ${form.dispatcherComment.trim()}`)
  }

  return lines.join('\n')
}

export default function MeteorologistRequestPage({ initialValues, onBack, onSent }) {
  const [form, setForm] = useState(() => createInitialForm(initialValues))
  const [needs, setNeeds] = useState(DEFAULT_METEOROLOGIST_NEEDS)
  const [sendStatus, setSendStatus] = useState('')

  const requestMessage = useMemo(() => buildRequestMessage(form, needs), [form, needs])

  const toggleNeed = (key) => {
    setNeeds((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const handleSendRequest = () => {
    const requestPayload = {
      id: `req-${Date.now()}`,
      createdAt: new Date().toISOString(),
      status: 'new',
      dispatcherName: 'Диспетчер рейсов',
      form,
      needs,
      requestText: requestMessage,
    }

    saveActiveMeteorologistRequest(requestPayload)

    const now = new Date().toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
    })

    setSendStatus(`Запрос отправлен метеорологу в ${now}.`)
    onSent?.()
  }

  return (
    <main className="meteo-request-page">
      <Paper withBorder radius="xl" p="lg" className="surface-card">
        <Stack gap="md">
          <Group justify="space-between" gap="sm" wrap="wrap">
            <Title order={2}>Запрос метеорологу</Title>
            <Button
              variant="default"
              radius="xl"
              leftSection={<IconChevronLeft size={16} />}
              onClick={onBack}
            >
              Обратно к рейсам
            </Button>
          </Group>

          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
            <TextInput
              label="Номер рейса"
              placeholder="SU1234"
              value={form.flightNumber}
              onChange={(event) => setForm((prev) => ({ ...prev, flightNumber: event.target.value }))}
            />

            <TextInput
              label="Аэропорт вылета (ICAO/IATA)"
              placeholder="UUEE / SVO"
              value={form.fromAirportId}
              onChange={(event) => setForm((prev) => ({ ...prev, fromAirportId: event.target.value }))}
            />

            <TextInput
              label="Аэропорт назначения"
              placeholder="UUDD / DME"
              value={form.toAirportId}
              onChange={(event) => setForm((prev) => ({ ...prev, toAirportId: event.target.value }))}
            />

            <TextInput
              label="Плановое время вылета (ETD)"
              type="datetime-local"
              value={form.etd}
              onChange={(event) => setForm((prev) => ({ ...prev, etd: event.target.value }))}
            />

            <TextInput
              label="Плановое время прилета (ETA)"
              type="datetime-local"
              value={form.eta}
              onChange={(event) => setForm((prev) => ({ ...prev, eta: event.target.value }))}
            />
          </SimpleGrid>

          <Paper withBorder radius="lg" p="md" className="surface-card surface-card--subtle">
            <Stack gap="xs">
              <Text fw={600}>Что требуется от метеоролога</Text>
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
                {METEOROLOGIST_NEEDS.map((option) => (
                  <Checkbox
                    key={option.key}
                    label={option.label}
                    checked={Boolean(needs[option.key])}
                    onChange={() => toggleNeed(option.key)}
                  />
                ))}
              </SimpleGrid>
            </Stack>
          </Paper>

          <Textarea
            label="Дополнительный комментарий диспетчера"
            minRows={3}
            autosize
            value={form.dispatcherComment}
            onChange={(event) => setForm((prev) => ({ ...prev, dispatcherComment: event.target.value }))}
            placeholder="Например: подтвердить условия по маршруту за 30 минут до ETD."
          />

          <Textarea label="Текст запроса" minRows={10} autosize value={requestMessage} readOnly />

          <Group gap="sm" wrap="wrap">
            <Button
              radius="xl"
              onClick={handleSendRequest}
              leftSection={<IconCheck size={16} />}
            >
              Отправить запрос
            </Button>
            {sendStatus && (
              <Alert color="teal" radius="md" variant="light">
                {sendStatus}
              </Alert>
            )}
          </Group>
        </Stack>
      </Paper>
    </main>
  )
}
