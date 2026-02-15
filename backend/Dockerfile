FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY requirements.txt ./
RUN pip install --upgrade pip && pip install -r requirements.txt

COPY app ./app

EXPOSE 8888

# 注意：本项目启动时会注册爬虫调度器，生产环境建议保持单进程，避免重复任务。
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8888"]
