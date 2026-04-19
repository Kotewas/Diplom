# Diplom

## Docker Compose

В проект добавлен единый `docker-compose.yml` для:
- `frontend` (React + Nginx, порт `5173`)
- `backend` (Spring Boot, порт `8080`)
- `db` (PostgreSQL, порт `5432`)

### Запуск

```bash
cp .env.example .env
docker compose up --build
```

После запуска:
- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:8080/api`
- PostgreSQL: `localhost:5432`
