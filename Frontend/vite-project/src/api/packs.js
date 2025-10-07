// src/api/packs.js
import axios from "axios";

const API_BASE = "http://localhost:8000/api";

export async function startPack(orderNo) {
  const res = await axios.post(`${API_BASE}/pack/start`, { order_no: orderNo });
  return res.data;
}

export async function getPackSnapshot(packId) {
  const res = await axios.get(`${API_BASE}/pack/${packId}`);
  return res.data;
}

export async function createBox(packId, body = {}) {
  const res = await axios.post(`http://localhost:8000/api/pack/${packId}/boxes`, body);
  return res.data;
}

export async function completePack(packId) {
  const res = await axios.post(`${API_BASE}/pack/${packId}/complete`);
  return res.data;
}
