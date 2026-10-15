"""E-commerce operations prototype: persistent orders and read-only Shopify sync."""
import os
import secrets
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Depends, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Literal
from sqlalchemy import select, func
from .storage import SessionLocal, StoredOrder, init_db
from .shopify import fetch_orders

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield

app = FastAPI(title="E-commerce Operations Agent MVP", version="0.2.0", lifespan=lifespan)
allowed_origin = os.getenv("FRONTEND_ORIGIN", "http://localhost:5174")
app.add_middleware(CORSMiddleware, allow_origins=[allowed_origin], allow_methods=["GET", "POST"], allow_headers=["X-API-Key", "Content-Type"])

def authorize(x_api_key: str | None = Header(default=None)):
    expected = os.getenv("ECOMMERCE_API_KEY", "")
    if expected and not secrets.compare_digest(x_api_key or "", expected):
        raise HTTPException(status_code=401, detail="Invalid API key")

Status = Literal["unfulfilled", "fulfilled", "cancelled", "returned"]
class Order(BaseModel):
    id: str = Field(min_length=1, max_length=128)
    status: Status
    days_pending: int = Field(ge=0, le=3650)

class OrderBatch(BaseModel):
    orders: list[Order] = Field(max_length=1000)

class ExceptionItem(BaseModel):
    order_id: str
    kind: str
    severity: str
    explanation: str
    suggested_action: str
    acknowledged: bool

def store_orders(batch: OrderBatch):
    ids = [order.id for order in batch.orders]
    if len(ids) != len(set(ids)):
        raise HTTPException(status_code=422, detail="Duplicate order IDs in batch")
    with SessionLocal.begin() as db:
        for order in batch.orders:
            existing = db.get(StoredOrder, order.id)
            if existing is None:
                db.add(StoredOrder(id=order.id, status=order.status, days_pending=order.days_pending, acknowledged=False))
            elif existing.status != order.status or existing.days_pending != order.days_pending:
                existing.status = order.status
                existing.days_pending = order.days_pending
                existing.acknowledged = False
        count = db.scalar(select(func.count()).select_from(StoredOrder))
    return {"imported": len(batch.orders), "total_orders": count}

@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/orders/import", dependencies=[Depends(authorize)])
def import_orders(batch: OrderBatch):
    return store_orders(batch)

@app.get("/exceptions", response_model=list[ExceptionItem], dependencies=[Depends(authorize)])
def list_exceptions():
    with SessionLocal() as db:
        records = db.scalars(select(StoredOrder).where(StoredOrder.status == "unfulfilled", StoredOrder.days_pending > 3).order_by(StoredOrder.id)).all()
        return [ExceptionItem(order_id=o.id, kind="delayed_fulfillment", severity="high" if o.days_pending > 7 else "medium",
                explanation=f"Order has remained unfulfilled for {o.days_pending} days.",
                suggested_action="Review fulfillment status and contact the operations team.", acknowledged=o.acknowledged) for o in records]

@app.post("/exceptions/{order_id}/acknowledge", dependencies=[Depends(authorize)])
def acknowledge_exception(order_id: str):
    with SessionLocal.begin() as db:
        order = db.get(StoredOrder, order_id)
        if order is None or order.status != "unfulfilled" or order.days_pending <= 3:
            raise HTTPException(status_code=404, detail="Active exception not found")
        order.acknowledged = True
    return {"order_id": order_id, "acknowledged": True}

@app.post("/shopify/sync", dependencies=[Depends(authorize)])
async def sync_shopify():
    try:
        orders = await fetch_orders()
        return store_orders(OrderBatch(orders=[Order(**o) for o in orders]))
    except (ValueError, KeyError) as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:
        # Never expose upstream credentials or raw HTTP errors to clients.
        raise HTTPException(status_code=502, detail="Shopify sync failed; inspect server logs") from exc
