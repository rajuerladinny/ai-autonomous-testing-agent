"""Read-only Shopify Admin GraphQL adapter for a single merchant pilot.

Use an authorized store access token with read_orders permission.
No OAuth, multi-tenancy, or automatic mutations in this prototype.
"""
import os
from datetime import datetime, timezone
from urllib.parse import urlparse
import httpx

QUERY = """
query Orders($first: Int!, $after: String) {
  orders(first: $first, after: $after, sortKey: CREATED_AT, reverse: true) {
    nodes { id displayName createdAt displayFulfillmentStatus cancelledAt }
    pageInfo { hasNextPage endCursor }
  }
}
"""

def configured_shop():
    domain = os.getenv("SHOPIFY_SHOP_DOMAIN", "").strip().lower()
    token = os.getenv("SHOPIFY_ADMIN_ACCESS_TOKEN", "").strip()
    if not domain or not token:
        raise ValueError("Shopify store domain and access token must be configured")
    parsed = urlparse("https://" + domain)
    if parsed.hostname != domain or not domain.endswith(".myshopify.com") or "/" in domain or "@" in domain:
        raise ValueError("Only a valid *.myshopify.com domain is allowed")
    return domain, token

async def fetch_orders(max_orders: int = 100):
    domain, token = configured_shop()
    api_version = os.getenv("SHOPIFY_API_VERSION", "2026-07")
    if api_version not in {"2026-01", "2026-04", "2026-07", "2026-10"}:
        raise ValueError("Unsupported Shopify API version")
    endpoint = f"https://{domain}/admin/api/{api_version}/graphql.json"
    result, cursor = [], None
    async with httpx.AsyncClient(timeout=20, follow_redirects=False) as client:
        while len(result) < max_orders:
            response = await client.post(endpoint, headers={"X-Shopify-Access-Token": token}, json={
                "query": QUERY, "variables": {"first": min(50, max_orders-len(result)), "after": cursor}
            })
            response.raise_for_status()
            payload = response.json()
            if payload.get("errors"):
                raise ValueError("Shopify returned GraphQL errors")
            data = payload.get("data", {}).get("orders")
            if not data:
                raise ValueError("Unexpected Shopify response")
            now = datetime.now(timezone.utc)
            for node in data["nodes"]:
                if node.get("cancelledAt"):
                    status = "cancelled"
                elif node.get("displayFulfillmentStatus") == "FULFILLED":
                    status = "fulfilled"
                else:
                    status = "unfulfilled"
                created = datetime.fromisoformat(node["createdAt"].replace("Z", "+00:00"))
                result.append({"id": node["id"], "status": status, "days_pending": max(0, (now-created).days)})
            page = data["pageInfo"]
            if not page["hasNextPage"]:
                break
            cursor = page["endCursor"]
            if not cursor:
                raise ValueError("Missing pagination cursor")
    return result
