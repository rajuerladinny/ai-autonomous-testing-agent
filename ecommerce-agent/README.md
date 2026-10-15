# AI E-commerce Operations Agent (Python MVP)

Independent experimental B2B product prototype. The existing Sentinel autonomous-testing application is unchanged.

## MVP
- Import order data as JSON through FastAPI.
- Detect overdue unfulfilled orders with deterministic rules.
- Review an exception queue and acknowledge an exception.
- No automatic refunds, cancellations, customer messaging or marketplace API access.
- All data is currently **in memory** and is lost when the server restarts. Do not use real customer data.

## Local setup
```bash
cd ecommerce-agent/backend
python -m venv .venv
# activate .venv for your operating system
pip install -r requirements.txt
uvicorn app.main:app --reload
pytest
```

API docs: http://127.0.0.1:8000/docs

Sample request:
```bash
curl -X POST http://127.0.0.1:8000/orders/import \
  -H 'Content-Type: application/json' \
  -d '{"orders":[{"id":"ORDER-100","status":"unfulfilled","days_pending":5},{"id":"ORDER-101","status":"fulfilled","days_pending":1}]}'
curl http://127.0.0.1:8000/exceptions
```

## Production roadmap
Persistent PostgreSQL storage, authentication and tenant isolation, verified platform webhooks, configurable thresholds, approval/audit workflows, rate limiting, job workers, React dashboard and AI-assisted explanations. Never expose this unauthenticated prototype to the public internet.
