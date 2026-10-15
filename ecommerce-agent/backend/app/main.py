"""Minimal, local-only e-commerce exception detection API.

Prototype only: no auth, persistence, external integrations, or autonomous actions.
"""
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from typing import Literal

app = FastAPI(title="E-commerce Operations Agent MVP", version="0.1.0")

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
    acknowledged: bool = False

orders: dict[str, Order] = {}
acknowledged: set[str] = set()

def detect_exceptions() -> list[ExceptionItem]:
    result = []
    for order in orders.values():
        if order.status == "unfulfilled" and order.days_pending > 3:
            result.append(ExceptionItem(
                order_id=order.id,
                kind="delayed_fulfillment",
                severity="high" if order.days_pending > 7 else "medium",
                explanation=f"Order has remained unfulfilled for {order.days_pending} days.",
                suggested_action="Review fulfillment status and contact the operations team.",
                acknowledged=order.id in acknowledged,
            ))
    return sorted(result, key=lambda item: item.order_id)

@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/orders/import")
def import_orders(batch: OrderBatch):
    ids = [order.id for order in batch.orders]
    if len(ids) != len(set(ids)):
        raise HTTPException(status_code=422, detail="Duplicate order IDs in batch")
    for order in batch.orders:
        previous = orders.get(order.id)
        orders[order.id] = order
        if previous != order:
            acknowledged.discard(order.id)
    return {"imported": len(batch.orders), "total_orders": len(orders)}

@app.get("/exceptions", response_model=list[ExceptionItem])
def list_exceptions():
    return detect_exceptions()

@app.post("/exceptions/{order_id}/acknowledge")
def acknowledge_exception(order_id: str):
    if not any(item.order_id == order_id for item in detect_exceptions()):
        raise HTTPException(status_code=404, detail="Active exception not found")
    acknowledged.add(order_id)
    return {"order_id": order_id, "acknowledged": True}
