FROM python:3.12-slim
WORKDIR /app
COPY planner_store.py pockethive_auth.py server.py import_workspace.py seed.json ./
COPY web ./web
RUN mkdir -p /data && chown -R 10001:10001 /data
ENV TESTPLANNER_DB=/data/planner.sqlite3 PORT=8765 PYTHONDONTWRITEBYTECODE=1
USER 10001:10001
EXPOSE 8765
CMD ["python", "server.py"]
