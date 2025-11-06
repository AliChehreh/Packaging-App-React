// src/api/packs.js
import axios from "axios";


const API_BASE = "http://localhost:8000/api";

export async function startPack(orderNo) {
  const payload = { order_no: orderNo };
  const res = await axios.post(`${API_BASE}/pack/start`, payload);
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

// Download packing slip PDF - Using HTML format
export async function downloadPackingSlip(packId) {
  try {
    // Use axios to include auth headers
    const response = await axios.get(`${API_BASE}/pack/${packId}/html-packing-slip.pdf`, {
      responseType: 'blob', // Important for binary data
    });
    
    // Create blob URL and trigger download
    const blob = new Blob([response.data], { type: 'application/pdf' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `packing_slip_${packId}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url); // Clean up
  } catch (error) {
    const msg = error.response?.data?.detail || error.message || "Failed to download packing slip";
    throw new Error(msg);
  }
}

export async function duplicateBox(packId, boxId) {
  try {
    const res = await axios.post(`${API_BASE}/pack/${packId}/boxes/${boxId}/duplicate`);
    return res.data;
  } catch (error) {
    const msg =
      error.response?.data?.detail?.error ||
      error.response?.data?.detail ||
      "Failed to duplicate box";
    throw new Error(msg);
  }
}

export async function printBoxLabel(packId, boxId, printerName = null) {
  try {
    // Get printer name from localStorage if not provided
    if (!printerName) {
      const settings = JSON.parse(localStorage.getItem('printerSettings') || '{}');
      const printerId = settings.boxLabelPrinter;
      
      if (printerId) {
        // Get actual printer name from backend
        try {
          const printersResponse = await axios.get(`${API_BASE}/pack/system/printers`);
          if (printersResponse.status === 200) {
            const printers = printersResponse.data;
            const printer = printers.find(p => p.id === printerId);
            printerName = printer ? printer.name : 'Default Printer';
          } else {
            printerName = 'Default Printer';
          }
        } catch (error) {
          console.error('Failed to get printer name:', error);
          printerName = 'Default Printer';
        }
      } else {
        printerName = 'Default Printer';
      }
    }
    
    const res = await axios.post(`${API_BASE}/pack/${packId}/boxes/${boxId}/print-label`, null, {
      params: { printer_name: printerName }
    });
    return res.data;
  } catch (error) {
    const msg =
      error.response?.data?.detail ||
      error.message ||
      "Failed to print box label";
    throw new Error(msg);
  }
}

export async function printAllBoxLabels(packId, printerName = null) {
  try {
    // Get printer name from localStorage if not provided
    if (!printerName) {
      const settings = JSON.parse(localStorage.getItem('printerSettings') || '{}');
      const printerId = settings.boxLabelPrinter;
      
      if (printerId) {
        // Get actual printer name from backend
        try {
          const printersResponse = await axios.get(`${API_BASE}/pack/system/printers`);
          if (printersResponse.status === 200) {
            const printers = printersResponse.data;
            const printer = printers.find(p => p.id === printerId);
            printerName = printer ? printer.name : 'Default Printer';
          } else {
            printerName = 'Default Printer';
          }
        } catch (error) {
          console.error('Failed to get printer name:', error);
          printerName = 'Default Printer';
        }
      } else {
        printerName = 'Default Printer';
      }
    }
    
    const res = await axios.post(`${API_BASE}/pack/${packId}/boxes/print-all-labels`, null, {
      params: { printer_name: printerName }
    });
    return res.data;
  } catch (error) {
    const msg =
      error.response?.data?.detail ||
      error.message ||
      "Failed to print all box labels";
    throw new Error(msg);
  }
}

export async function previewPackingSlipHtml(packId) {
  try {
    // Get auth token to include in URL for the new window
    const token = localStorage.getItem('auth_token');
    if (!token) {
      throw new Error("Not authenticated");
    }
    // Include token as query parameter for the new window
    const url = `${API_BASE}/pack/${packId}/html-preview?token=${token}`;
    window.open(url, '_blank');
    return { success: true };
  } catch (error) {
    const msg =
      error.response?.data?.detail ||
      error.message ||
      "Failed to open packing slip preview";
    throw new Error(msg);
  }
}

// Completed Packs History API functions
export async function getCompletedPacks(date = null, search = null) {
  try {
    const params = new URLSearchParams();
    if (date) params.append('date', date);
    if (search) params.append('search', search);
    
    const response = await axios.get(`${API_BASE}/pack/completed?${params.toString()}`);
    return response.data;
  } catch (error) {
    let msg = "Failed to fetch completed packs";
    if (error.response?.status === 401) {
      msg = "Authentication required. Please log in again.";
    } else if (error.response?.status === 403) {
      msg = "Access denied. Supervisor role required.";
    } else if (error.response?.status === 422) {
      msg = "Invalid request parameters. Please check your input.";
    } else if (error.response?.data?.detail) {
      msg = error.response.data.detail;
    } else if (error.message) {
      msg = error.message;
    }
    
    throw new Error(msg);
  }
}

export async function reopenPack(packId) {
  try {
    const response = await axios.post(`${API_BASE}/pack/${packId}/reopen`);
    return response.data;
  } catch (error) {
    const msg = error.response?.data?.detail || error.message || "Failed to reopen pack";
    throw new Error(msg);
  }
}

export async function getUPSRate(packId) {
  try {
    const response = await axios.post(`${API_BASE}/pack/${packId}/ups-rate`);
    return response.data;
  } catch (error) {
    let msg = "Failed to get UPS rate";
    if (error.response?.status === 401) {
      msg = "Authentication required. Please log in again.";
    } else if (error.response?.status === 403) {
      msg = "Access denied. Supervisor role required.";
    } else if (error.response?.status === 400) {
      msg = error.response.data?.detail || "Invalid request. Please check pack data.";
    } else if (error.response?.status === 404) {
      msg = error.response.data?.detail || "Pack or order not found.";
    } else if (error.response?.status === 500) {
      msg = error.response.data?.detail || "Server error. UPS API may not be configured.";
    } else if (error.response?.data?.detail) {
      msg = error.response.data.detail;
    } else if (error.message) {
      msg = error.message;
    }
    throw new Error(msg);
  }
}