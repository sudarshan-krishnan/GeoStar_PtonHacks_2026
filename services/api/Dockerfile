# GeoStar data API. Build from services/api:  docker build -t plotstar-api .
# The CoStar kit and SQLite store are NOT baked in (licensed data): mount them and pass keys as env vars.
#   docker run -p 8000:8000 -e COSTAR_KIT_DIR=/kit -e PLOTSTAR_DB=/data/plotstar.db \
#     -e AWS_REGION=us-east-1 -e BEDROCK_MODEL_ID=<model id> -v <kit>:/kit:ro -v <data>:/data plotstar-api
# Not built or deployed in this repo's CI; see docs/sponsors/amazon.md.
FROM python:3.12-slim
WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
ENV PYTHONUNBUFFERED=1
EXPOSE 8000
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
