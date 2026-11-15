# Build context: src/  (the code is imported as the `backend` package)
# Runs locally (docker compose) and on Google Cloud Run, which sets $PORT.
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOME=/home/nsin \
    PORT=8080

WORKDIR /srv
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend/ backend/

# Run as an unprivileged user.
RUN useradd --system --uid 10001 --create-home --home-dir /home/nsin nsin \
    && chown -R nsin /srv
USER nsin

EXPOSE 8080
CMD ["sh", "-c", "exec uvicorn backend.app.main:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*'"]
