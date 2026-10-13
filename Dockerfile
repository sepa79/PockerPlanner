FROM python:3.12-slim
RUN apt-get update && apt-get upgrade -y --no-install-recommends && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt ./
RUN python -m pip install --no-cache-dir --upgrade pip==26.2.1 \
    && python -m pip install --no-cache-dir -r requirements.txt \
    && python -m pip uninstall --yes pip
COPY planner_store.py planner_commands.py planner_mcp.py pockethive_auth.py server.py import_workspace.py seed.json ./
COPY web ./web
RUN mkdir -p /data && chown -R 10001:10001 /data
ENV TESTPLANNER_DB=/data/planner.sqlite3 PORT=8765 PYTHONDONTWRITEBYTECODE=1
USER 10001:10001
EXPOSE 8765
CMD ["python", "server.py"]
