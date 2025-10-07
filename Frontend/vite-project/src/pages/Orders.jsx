// src/pages/Orders.jsx
import { useState } from "react";
import { Input, Button, Card, Table, message, Spin, Space } from "antd";
import { getOesOrder } from "../api/orders";
import { startPack, getPackSnapshot } from "../api/packs";

export default function Orders() {
  const [mode, setMode] = useState("scan"); // "scan" | "preview" | "pack"
  const [orderNo, setOrderNo] = useState("");
  const [loading, setLoading] = useState(false);
  const [oesData, setOesData] = useState(null);
  const [pack, setPack] = useState(null);

  async function handleScan(value) {
    if (!value) return;
    setLoading(true);
    try {
      const data = await getOesOrder(value.trim());
      setOesData(data);
      setMode("preview");
    } catch (err) {
      message.error("Order not found in OES");
    } finally {
      setLoading(false);
    }
  }

  async function handleStartPack() {
    setLoading(true);
    try {
      const res = await startPack(orderNo.trim());
      const snap = await getPackSnapshot(res.pack_id);
      setPack(snap);
      setMode("pack");
    } catch (err) {
      message.error(err.response?.data?.detail || "Failed to start pack");
    } finally {
      setLoading(false);
    }
  }

  const lineColumns = [
    { title: "Product Code", dataIndex: "product_code", key: "product_code" },
    { title: "Length", dataIndex: "length_in", key: "length_in" },
    { title: "Height", dataIndex: "height_in", key: "height_in" },
    { title: "Qty", dataIndex: "qty_ordered", key: "qty_ordered" },
    { title: "Finish", dataIndex: "finish", key: "finish" },
  ];

  if (loading)
    return (
      <div style={{ textAlign: "center", marginTop: 100 }}>
        <Spin size="large" />
      </div>
    );

  // --- Scan Mode ---
  if (mode === "scan") {
    return (
      <div style={{ maxWidth: 400, margin: "80px auto", textAlign: "center" }}>
        <h2>Scan or Enter Order #</h2>
        <Input.Search
          placeholder="Order number"
          enterButton="Search"
          size="large"
          onSearch={(val) => {
            setOrderNo(val);
            handleScan(val);
          }}
          autoFocus
        />
      </div>
    );
  }

  // --- Preview Mode ---
  if (mode === "preview") {
    return (
      <div style={{ padding: 24 }}>
        <Card title={`Order #${orderNo}`} style={{ marginBottom: 16 }}>
          <p>
            <b>Customer:</b> {oesData?.header?.customer_name}
          </p>
          <p>
            <b>Ship To:</b> {oesData?.header?.ship_name}
          </p>
          <p>
            <b>Due Date:</b> {oesData?.header?.due_date}
          </p>
        </Card>

        <Table
          rowKey={(r, idx) =>
            `${r.product_code}-${r.length_in}-${r.height_in}-${idx}`
          }
          dataSource={oesData?.lines || []}
          columns={lineColumns}
          pagination={false}
        />

        <div style={{ marginTop: 16 }}>
          <Space>
            <Button type="primary" onClick={handleStartPack}>
              Start Pack
            </Button>
            <Button onClick={() => setMode("scan")}>Back</Button>
          </Space>
        </div>
      </div>
    );
  }

  // --- Pack Mode ---
// --- Pack Mode ---
if (mode === "pack") {
  const packId = pack?.header?.pack_id || pack?.id; // handle both shapes safely

  async function handleAddBox() {
    try {
      const res = await createBox(packId, {}); // no args -> default empty box
      message.success(`Box #${res.box_no} created`);
      const snap = await getPackSnapshot(packId);
      setPack(snap);
    } catch (err) {
      message.error(err.response?.data?.detail || "Failed to create box");
    }
  }

  async function handleCompletePack() {
    try {
      await completePack(packId);
      message.success("Pack marked as complete");
      const snap = await getPackSnapshot(packId);
      setPack(snap);
    } catch (err) {
      message.error(err.response?.data?.detail || "Failed to complete pack");
    }
  }

  return (
    <div style={{ padding: 24 }}>
      <Card
        title={`Packing Order #${pack.header.order_no}`}
        extra={
          <Space>
            <Button onClick={() => setMode("scan")}>New Order</Button>
            <Button type="primary" danger onClick={handleCompletePack}>
              Complete Pack
            </Button>
          </Space>
        }
      >
        <p>
          Customer: <b>{pack.header.customer_name}</b> | Status:{" "}
          <b>{pack.header.status}</b>
        </p>
      </Card>

      <div style={{ display: "flex", gap: 16, marginTop: 16 }}>
        {/* LEFT: Lines */}
        <Card title="Order Lines" style={{ flex: 1 }}>
          <Table
            size="small"
            rowKey={(r) => r.id}
            dataSource={pack.lines}
            columns={[
              { title: "Product", dataIndex: "product_code" },
              { title: "Remaining", dataIndex: "remaining" },
              { title: "Packed", dataIndex: "packed_qty" },
            ]}
            pagination={false}
          />
        </Card>

        {/* RIGHT: Boxes */}
        <Card
          title={
            <Space>
              Boxes
              <Button type="primary" size="small" onClick={handleAddBox}>
                + Add Box
              </Button>
            </Space>
          }
          style={{ flex: 1 }}
        >
          {pack.boxes.length === 0 ? (
            <p>No boxes yet.</p>
          ) : (
            pack.boxes.map((b) => (
              <Card
                key={b.id}
                size="small"
                title={b.label}
                style={{ marginBottom: 8 }}
              >
                {b.items.length === 0 ? (
                  <i>Empty box</i>
                ) : (
                  b.items.map((it) => (
                    <p key={it.id}>
                      {it.product_code} × {it.qty}
                    </p>
                  ))
                )}
              </Card>
            ))
          )}
        </Card>
      </div>
    </div>
  );
}

  return null;
}
