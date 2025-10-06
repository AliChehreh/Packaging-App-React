// src/api/orders.js
import axios from "axios";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000/api";

/**
 * Fetch an order preview directly from OES.
 * Used when the user scans or enters an order number.
 */
export async function getOesOrder(orderNo) {
  if (!orderNo) throw new Error("Missing order number");
  const res = await axios.get(`${API_BASE}/orders/oes/${encodeURIComponent(orderNo)}`);
  return res.data;
}

/**
 * Fetch an order from the local app database (after it's been imported).
 * Usually not called directly — packing pages use /api/pack/{id}.
 */
export async function getAppOrder(orderNo) {
  const res = await axios.get(`${API_BASE}/orders/${encodeURIComponent(orderNo)}`);
  return res.data;
}

/**
 * Import/sync an order from OES into the local database.
 * The backend will pull data from OES, normalize, and persist it.
 */
export async function syncOrder(orderNo) {
  const res = await axios.post(`${API_BASE}/orders/sync`, { order_no: orderNo });
  return res.data;
}

/**
 * Optional helper for listing orders that already exist in the local DB.
 * Not critical for v1, but useful later for admin dashboards.
 */
export async function listOrders(params = {}) {
  const res = await axios.get(`${API_BASE}/orders`, { params });
  return res.data;
}
