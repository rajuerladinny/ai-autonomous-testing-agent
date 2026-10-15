from fastapi.testclient import TestClient
from app.main import app, orders, acknowledged

client = TestClient(app)

def setup_function():
    orders.clear()
    acknowledged.clear()

def test_import_and_detect():
    response = client.post("/orders/import", json={"orders": [
        {"id": "A", "status": "unfulfilled", "days_pending": 5},
        {"id": "B", "status": "fulfilled", "days_pending": 9},
        {"id": "C", "status": "unfulfilled", "days_pending": 3}
    ]})
    assert response.status_code == 200
    data = client.get("/exceptions").json()
    assert len(data) == 1
    assert data[0]["order_id"] == "A"
    assert data[0]["severity"] == "medium"

def test_acknowledgement_and_reset_on_change():
    client.post("/orders/import", json={"orders": [{"id": "A", "status": "unfulfilled", "days_pending": 8}]})
    assert client.post("/exceptions/A/acknowledge").json()["acknowledged"]
    assert client.get("/exceptions").json()[0]["acknowledged"]
    client.post("/orders/import", json={"orders": [{"id": "A", "status": "unfulfilled", "days_pending": 9}]})
    assert not client.get("/exceptions").json()[0]["acknowledged"]

def test_invalid_order_rejected():
    assert client.post("/orders/import", json={"orders": [{"id": "X", "status": "unfulfilled", "days_pending": -1}]}).status_code == 422

def test_unknown_exception_not_acknowledged():
    assert client.post("/exceptions/missing/acknowledge").status_code == 404
