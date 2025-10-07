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

export async function assignOne(packId, boxId, orderLineId) {
  const res = await axios.post(
    `http://localhost:8000/api/pack/${packId}/assign-one`,
    { box_id: boxId, order_line_id: orderLineId }
  );
  return res.data;
}

export async function setQty(packId, boxId, orderLineId, qty) {
  const res = await axios.post(
    `http://localhost:8000/api/pack/${packId}/set-qty`,
    { box_id: boxId, order_line_id: orderLineId, qty }
  );
  return res.data;
}
