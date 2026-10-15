import os
import tempfile
from fastapi.testclient import TestClient

# Configure an isolated SQLite database before importing the app.
_temp = tempfile.TemporaryDirectory()
os.environ["DATABASE_URL"] = "sqlite:///" + _temp.name + "/test.db"
from app.main import app
from app.storage import SessionLocal, StoredOrder

def setup_function():
    with SessionLocal.begin() as db:
        db.query(StoredOrder).delete()

def test_import_detect_acknowledge():
    with TestClient(app) as client:
        assert client.post("/orders/import", json={"orders": [
            {"id": "A", "status": "unfulfilled", "days_pending": 8},
            {"id": "B", "status": "fulfilled", "days_pending": 9}]}).status_code == 200
        data = client.get("/exceptions").json()
        assert len(data) == 1 and data[0]["severity"] == "high"
        assert client.post("/exceptions/A/acknowledge").status_code == 200
        assert client.get("/exceptions").json()[0]["acknowledged"]
        client.post("/orders/import", json={"orders": [{"id": "A", "status": "unfulfilled", "days_pending": 9}]})
        assert not client.get("/exceptions").json()[0]["acknowledged"]

def test_validation():
    with TestClient(app) as client:
        assert client.post("/orders/import", json={"orders": [{"id": "A", "status": "unfulfilled", "days_pending": -1}]}).status_code == 422
        assert client.post("/exceptions/missing/acknowledge").status_code == 404
