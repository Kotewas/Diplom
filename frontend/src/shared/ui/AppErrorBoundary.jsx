import { Component } from 'react'
import { Button, Paper, Stack, Text, Title } from '@mantine/core'

export class AppErrorBoundary extends Component {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error) {
    console.error('App crashed:', error)
  }

  handleReload = () => {
    window.location.reload()
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children
    }

    return (
      <Paper withBorder radius="xl" p="xl" className="surface-card" maw={640} mx="auto">
        <Stack gap="md">
          <Title order={3}>Интерфейс восстановлен после ошибки</Title>
          <Text c="dimmed">
            Обновите экран, и работа продолжится с сохраненными данными.
          </Text>
          <Button radius="xl" onClick={this.handleReload}>
            Обновить экран
          </Button>
        </Stack>
      </Paper>
    )
  }
}
