FROM python:3.12-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application source code
COPY app/ app/
COPY static/ static/
COPY main.py run.py ./

EXPOSE 8000

CMD ["python", "run.py"]
