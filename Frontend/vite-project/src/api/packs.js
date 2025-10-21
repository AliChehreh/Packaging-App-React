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
  try {
    const response = await axios.post(`${API_BASE}/pack/${packId}/complete`);
    return response.data;
  } catch (error) {
    // ✅ Handle backend validation errors cleanly
    if (error.response?.status === 400 && error.response.data?.detail) {
      // The backend sends: { "detail": { "error": "message here" } }
      const msg =
        error.response.data.detail.error ||
        error.response.data.detail ||
        "Validation error";
      throw new Error(msg);
    }

    // Generic fallback
    throw new Error(
      error.response?.data?.detail?.error ||
        error.message ||
        "Unexpected server error"
    );
  }
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
export async function setBoxWeight(packId, boxId, weight) {
  try {
    const body = { weight: weight ?? null };
    const response = await axios.post(`${API_BASE}/pack/${packId}/boxes/${boxId}/weight`, body);
    return response.data;
  } catch (error) {
    const msg =
      error.response?.data?.detail?.error ||
      error.response?.data?.detail ||
      "Failed to set weight";
    throw new Error(msg);
  }
}

export async function deleteBox(packId, boxId) {
  try {
    const res = await axios.delete(`${API_BASE}/pack/${packId}/boxes/${boxId}`);
    return res.data;
  } catch (err) {
    const msg =
      err?.response?.data?.detail || err.message || "Failed to delete box";
    throw new Error(msg);
  }
}

export async function removeItemFromBox(packId, boxId, orderLineId, qty = 1) {
  try {
    const res = await axios.post(
      `${API_BASE}/pack/${packId}/boxes/${boxId}/remove-item`,
      { order_line_id: orderLineId, qty }
    );
    return res.data;
  } catch (err) {
    const msg =
      err?.response?.data?.detail ||
      err.message ||
      "Failed to remove item from box";
    throw new Error(msg);
  }
}

// Download packing slip PDF
export async function downloadPackingSlip(packId) {
  const url = `${API_BASE}/pack/${packId}/packing-slip.pdf`;
  // If you don’t need custom headers/auth, streaming is simplest:
  const a = document.createElement("a");
  a.href = url;
  a.download = `packing_slip_${packId}.pdf`; // browser may ignore; server filename wins
  document.body.appendChild(a);
  a.click();
  a.remove();
}