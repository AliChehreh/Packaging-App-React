// src/api/cartons.js
import axios from "axios";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000/api";

export async function listCartons({ activeOnly = true } = {}) {
  const res = await axios.get(`${API_BASE}/cartons`, {
    params: { active_only: activeOnly }
  });
  return res.data;
}

export async function createCarton(payload) {
  const res = await axios.post(`${API_BASE}/cartons`, payload);
  return res.data;
}

export async function updateCarton(id, payload) {
  const res = await axios.put(`${API_BASE}/cartons/${id}`, payload);
  return res.data;
}

export async function adjustInventory(id, delta) {
  const res = await axios.post(`${API_BASE}/cartons/${id}/adjust`, { delta });
  return res.data;
}

export async function listCartonTypes() {
  const res = await axios.get(`${API_BASE}/cartons`);
  return res.data;
}
