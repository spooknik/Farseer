# Build stage for frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Build stage for backend
FROM golang:1.21-alpine AS backend-builder
RUN apk add --no-cache gcc musl-dev
WORKDIR /app
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
RUN CGO_ENABLED=1 GOOS=linux go build -o farseer .

# Final stage
FROM alpine:latest
RUN apk add --no-cache ca-certificates tzdata

WORKDIR /app

# Copy backend binary
COPY --from=backend-builder /app/farseer .

# Copy frontend build
COPY --from=frontend-builder /app/frontend/dist ./static

# Create data directory
RUN mkdir -p /data

# Set environment variables
ENV FARSEER_PORT=8080
ENV FARSEER_CONFIG_DIR=/data
ENV FARSEER_DB_PATH=/data/farseer.db
ENV FARSEER_PRODUCTION=true

EXPOSE 8080

VOLUME ["/data"]

CMD ["./farseer"]
