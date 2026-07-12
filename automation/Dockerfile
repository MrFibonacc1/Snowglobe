FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 AUTOMATION_DB=/data/automation.db
WORKDIR /app
COPY automation/requirements.txt /app/automation/requirements.txt
RUN python -m pip install --no-cache-dir -r /app/automation/requirements.txt
COPY shared/ /app/shared/
COPY automation/ /app/automation/
EXPOSE 8000
CMD ["python", "-m", "uvicorn", "main:app", "--app-dir", "/app/automation", "--host", "0.0.0.0", "--port", "8000"]
