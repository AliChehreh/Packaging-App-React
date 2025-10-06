const BASE_URL = "http://localhost:8000";

export async function listCartons({ activeOnly = true } = {}) {
  const url = new URL(`${BASE_URL}/api/cartons`);
  url.searchParams.set("active_only", activeOnly ? "true" : "false");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Cartons fetch failed: ${res.status}`);
  return res.json();
}

export async function createCarton(payload) {
  const res = await fetch(`${BASE_URL}/api/cartons`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Create failed: ${res.status}`);
  return res.json();
}

export async function updateCarton(id, payload) {
  const res = await fetch(`${BASE_URL}/api/cartons/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Update failed: ${res.status}`);
  return res.json();
}

export async function adjustInventory(id, delta) {
  const res = await fetch(`${BASE_URL}/api/cartons/${id}/adjust`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ delta }),
  });
  if (!res.ok) throw new Error(`Adjust failed: ${res.status}`);
  return res.json();
}
