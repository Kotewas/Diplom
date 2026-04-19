import { useMemo, useState } from 'react'
import {
  Alert,
  Badge,
  Button,
  Grid,
  Group,
  List,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  Title,
} from '@mantine/core'
import { IconChevronLeft, IconSend2 } from '@tabler/icons-react'
import { METEOROLOGIST_NEEDS } from '../model/meteorologistNeeds'
import {
  markIncomingNotificationRead,
  readActiveMeteorologistRequest,
  readMeteorologistChatLog,
  updateActiveMeteorologistResponse,
} from '../services/meteorologistRequestsStorage'
import './MeteorologistPage.css'

function formatDateTime(value) {
  if (!value) return 'нет данных'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'нет данных'
  return date.toLocaleString('ru-RU')
}

function createResponseDraft(request) {
  if (!request) return {}

  return Object.fromEntries(
    METEOROLOGIST_NEEDS.filter((item) => request.needs?.[item.key]).map((item) => [
      item.key,
      request.responseByNeed?.[item.key] ?? '',
    ]),
  )
}

function resolveRequestForNotification(notification, notifications) {
  if (!notification) return null

  const liveRequest = readActiveMeteorologistRequest()
  if (liveRequest && liveRequest.id === notification.requestId) {
    return liveRequest
  }

  const answeredNotification = (notifications ?? []).find(
    (item) =>
      item.requestId === notification.requestId &&
      item.direction === 'outgoing' &&
      item.requestSnapshot,
  )
  if (answeredNotification?.requestSnapshot) {
    return answeredNotification.requestSnapshot
  }

  return notification.requestSnapshot ?? null
}

export default function MeteorologistPage({ onBack, backLabel = 'К таблице рейсов' }) {
  const [chatLog, setChatLog] = useState(() => readMeteorologistChatLog())
  const [activeNotificationId, setActiveNotificationId] = useState('')
  const [selectedRequest, setSelectedRequest] = useState(null)
  const [responseByNeed, setResponseByNeed] = useState({})
  const [submitStatus, setSubmitStatus] = useState('')

  const requestedNeeds = useMemo(
    () => METEOROLOGIST_NEEDS.filter((item) => selectedRequest?.needs?.[item.key]),
    [selectedRequest],
  )

  const openNotification = (notification) => {
    const nextLog =
      notification?.direction === 'incoming'
        ? markIncomingNotificationRead(notification.requestId)
        : readMeteorologistChatLog()

    setChatLog(nextLog)
    setActiveNotificationId(notification.id)
    const updatedNotification = nextLog.find((item) => item.id === notification.id) ?? notification
    const request = resolveRequestForNotification(updatedNotification, nextLog)
    setSelectedRequest(request)
    setResponseByNeed(createResponseDraft(request))
    setSubmitStatus('')
  }

  const updateNeedValue = (needKey, nextValue) => {
    setResponseByNeed((prev) => ({
      ...prev,
      [needKey]: nextValue,
    }))
  }

  const handleSubmitResponse = () => {
    if (!selectedRequest) return

    const updatedRequest = updateActiveMeteorologistResponse(responseByNeed)
    if (!updatedRequest) {
      setSubmitStatus('Этот запрос уже закрыт или не активен.')
      return
    }

    setChatLog(readMeteorologistChatLog())
    setSelectedRequest(null)
    setActiveNotificationId('')
    setResponseByNeed({})
    setSubmitStatus(
      `Ответ отправлен диспетчеру ${updatedRequest.dispatcherName || 'Диспетчер'} в ${formatDateTime(updatedRequest.answeredAt)}.`,
    )
  }

  const isRequestAnswered = selectedRequest?.status === 'answered'

  return (
    <main className="meteorologist-page">
      <Grid gutter="md">
        <Grid.Col span={{ base: 12, xl: 8 }}>
          <Paper withBorder radius="xl" p="lg" className="surface-card">
            <Stack gap="md">
              <Group justify="space-between" gap="sm" wrap="wrap">
                <Title order={2}>Метеоролог</Title>
                {onBack && (
                  <Button
                    variant="default"
                    radius="xl"
                    leftSection={<IconChevronLeft size={16} />}
                    onClick={onBack}
                  >
                    {backLabel}
                  </Button>
                )}
              </Group>

              {!selectedRequest ? (
                <Paper withBorder radius="lg" p="md" className="surface-card surface-card--subtle">
                  <Stack gap="xs">
                    <Title order={4}>Запрос не выбран</Title>
                    {submitStatus && (
                      <Alert color="teal" radius="md" variant="light">
                        {submitStatus}
                      </Alert>
                    )}
                  </Stack>
                </Paper>
              ) : (
                <>
                  <Paper withBorder radius="lg" p="md" className="surface-card surface-card--subtle">
                    <Stack gap="xs">
                      <Group justify="space-between" wrap="wrap">
                        <Title order={4}>
                          {isRequestAnswered ? 'Запрос уже обработан' : 'Пришел новый запрос'}
                        </Title>
                        <Badge color={isRequestAnswered ? 'teal' : 'blue'} variant="light">
                          {isRequestAnswered ? 'answered' : 'new'}
                        </Badge>
                      </Group>
                      <Text>
                        От <strong>{selectedRequest.dispatcherName || 'Диспетчер'}</strong> по рейсу{' '}
                        <strong>{selectedRequest.form?.flightNumber || 'не указан'}</strong>
                      </Text>
                      <Text>
                        Маршрут: {selectedRequest.form?.fromAirportId || '---'} -{' '}
                        {selectedRequest.form?.toAirportId || '---'}
                      </Text>
                      <Text>
                        ETD: {selectedRequest.form?.etd || 'не указано'} | ETA:{' '}
                        {selectedRequest.form?.eta || 'не указано'}
                      </Text>
                      <Text>Получен: {formatDateTime(selectedRequest.createdAt)}</Text>
                      {isRequestAnswered && (
                        <Text>Ответ отправлен: {formatDateTime(selectedRequest.answeredAt)}</Text>
                      )}
                    </Stack>
                  </Paper>

                  <Paper withBorder radius="lg" p="md" className="surface-card surface-card--subtle">
                    <Stack gap="xs">
                      <Title order={4}>Какие данные нужны</Title>
                      <List spacing="xs" size="sm">
                        {requestedNeeds.map((need) => (
                          <List.Item key={need.key}>{need.label}</List.Item>
                        ))}
                      </List>
                    </Stack>
                  </Paper>

                  <Paper withBorder radius="lg" p="md" className="surface-card surface-card--subtle">
                    <Stack gap="sm">
                      <Title order={4}>
                        {isRequestAnswered
                          ? 'Данные, которые были отправлены диспетчеру'
                          : 'Введите данные для диспетчера'}
                      </Title>
                      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                        {requestedNeeds.map((need) => (
                          <Textarea
                            key={need.key}
                            label={need.responseLabel}
                            minRows={3}
                            autosize
                            value={responseByNeed[need.key] ?? ''}
                            placeholder={need.placeholder}
                            readOnly={isRequestAnswered}
                            onChange={(event) => updateNeedValue(need.key, event.target.value)}
                          />
                        ))}
                      </SimpleGrid>
                    </Stack>
                  </Paper>

                  {!isRequestAnswered && (
                    <Group gap="sm" wrap="wrap">
                      <Button
                        radius="xl"
                        leftSection={<IconSend2 size={16} />}
                        onClick={handleSubmitResponse}
                      >
                        Отправить обратно диспетчеру
                      </Button>
                      {submitStatus && (
                        <Alert color="teal" radius="md" variant="light">
                          {submitStatus}
                        </Alert>
                      )}
                    </Group>
                  )}
                </>
              )}
            </Stack>
          </Paper>
        </Grid.Col>

        <Grid.Col span={{ base: 12, xl: 4 }}>
          <Paper withBorder radius="xl" p="lg" className="surface-card">
            <Stack gap="sm">
              <Title order={3}>Уведомления</Title>
              {chatLog.length === 0 ? (
                <Text c="dimmed">Пока уведомлений нет.</Text>
              ) : (
                <div className="chat-list">
                  {chatLog.map((chatItem) => (
                    <button
                      key={chatItem.id}
                      type="button"
                      className={`chat-item ${chatItem.direction === 'outgoing' ? 'outgoing' : 'incoming'} ${chatItem.direction === 'incoming' && !chatItem.isRead ? 'unread' : ''} ${chatItem.direction === 'incoming' && chatItem.isRead && chatItem.isAnswered ? 'answered' : ''} ${activeNotificationId === chatItem.id ? 'active' : ''}`}
                      onClick={() => openNotification(chatItem)}
                    >
                      <div className="chat-item-top">
                        <strong>
                          {chatItem.direction === 'outgoing'
                            ? 'Метеоролог'
                            : chatItem.dispatcherName || 'Диспетчер'}
                        </strong>
                        <span>{formatDateTime(chatItem.createdAt)}</span>
                      </div>
                      <p>
                        {chatItem.direction === 'outgoing'
                          ? 'Данные успешно отправлены'
                          : chatItem.text}
                      </p>
                      {chatItem.flightNumber && <small>Рейс: {chatItem.flightNumber}</small>}
                    </button>
                  ))}
                </div>
              )}
            </Stack>
          </Paper>
        </Grid.Col>
      </Grid>
    </main>
  )
}
