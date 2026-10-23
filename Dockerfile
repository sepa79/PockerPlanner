FROM node:22-alpine AS frontend
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
COPY frontend/vendor ./vendor
RUN npm ci
COPY frontend ./
RUN npm test && npm run build

FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /build
COPY backend/pom.xml backend/pom.xml
COPY backend/vendor backend/vendor
COPY backend/scripts backend/scripts
COPY backend/src backend/src
COPY tests/contracts tests/contracts
COPY VERSION seed.json ./
COPY --from=frontend /build/frontend/dist frontend/dist
RUN --mount=type=cache,target=/root/.m2 mvn -B -ntp -f backend/pom.xml verify

FROM eclipse-temurin:21-jre-jammy
RUN apt-get update \
    && apt-get upgrade -y --no-install-recommends \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 pocketplanner \
    && useradd --uid 10001 --gid 10001 --no-create-home pocketplanner \
    && mkdir /data && chown 10001:10001 /data
WORKDIR /app
COPY --from=build /build/backend/target/pocketplanner.jar /app/pocketplanner.jar
ENV TESTPLANNER_DB=/data/planner.sqlite3 PORT=8765 BIND_ADDRESS=0.0.0.0
USER 10001:10001
EXPOSE 8765
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD curl --fail --silent --show-error --max-time 3 http://127.0.0.1:8765/health || exit 1
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=70", "-jar", "/app/pocketplanner.jar"]
