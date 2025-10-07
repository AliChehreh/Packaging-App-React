// src/pages/Orders.jsx
import { useState, useEffect } from "react";
import {
  Input,
  Button,
  Card,
  Table,
  message,
  Spin,
  Space,
  Modal,
  Form,
  InputNumber,
  Radio,
  Select,
} from "antd";
import { getOesOrder } from "../api/orders";
import {
  startPack,
  getPackSnapshot,
  createBox,
  completePack,
} from "../api/packs";
import { listCartonTypes } from "../api/cartons";

/* ------------------------------------------------------------------ */
/*  AddBoxModal: modal popup for creating boxes (custom or predefined) */
/* ------------------------------------------------------------------ */
function AddBoxModal({ visible, onClose, packId, onBoxAdded }) {
  const [form] = Form.useForm();
  const [mode, setMode] = useState("custom");
  const [cartons, setCartons] = useState([]);

  useEffect(() => {
    if (visible && mode === "predefined") {
      listCartonTypes()
        .then(setCartons)
        .catch(() => message.error("Failed to load carton list"));
    }
  }, [visible, mode]);

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      const body =
        mode === "custom"
          ? {
              length_in: values.length_in,
              width_in: values.width_in,
              height_in: values.height_in,
            }
          : { carton_type_id: values.carton_type_id };

      await createBox(packId, body);
      message.success("Box created");
      await onBoxAdded(); // refresh snapshot
      onClose();
      form.resetFields();
      setMode("custom");
    } catch (err) {
      if (err?.response?.data?.detail)
        message.error(err.response.data.detail);
    }
  };

  return (
    <Modal
      title="Add New Box"
      open={visible}
      onOk={handleOk}
      onCancel={onClose}
      okText="Add Box"
      destroyOnClose
    >
      <Radio.Group
        value={mode}
        onChange={(e) => setMode(e.target.value)}
        style={{ marginBottom: 16 }}
      >
        <Radio.Button value="custom">Custom Size</Radio.Button>
        <Radio.Button value="predefined">Predefined</Radio.Button>
      </Radio.Group>

      {mode === "custom" ? (
        <Form form={form} layout="vertical">
          <Form.Item
            label="Length (in)"
            name="length_in"
            rules={[{ required: true, message: "Enter length" }]}
          >
            <InputNumber min={1} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item
            label="Width (in)"
            name="width_in"
            rules={[{ required: true, message: "Enter width" }]}
          >
            <InputNumber min={1} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item
            label="Height (in)"
            name="height_in"
            rules={[{ required: true, message: "Enter height" }]}
          >
            <InputNumber min={1} style={{ width: "100%" }} />
          </Form.Item>
        </Form>
      ) : (
        <Form form={form} layout="vertical">
          <Form.Item
            label="Select Carton Type"
            name="carton_type_id"
            rules={[{ required: true, message: "Select a carton" }]}
          >
            <Select
              showSearch
              placeholder="Search or select a carton"
              optionFilterProp="children"
              filterOption={(input, option) =>
                option.children
                  .toLowerCase()
                  .includes(input.toLowerCase())
              }
            >
              {cartons.map((c) => (
                <Select.Option key={c.id} value={c.id}>
                  {c.name} ({c.length_in}×{c.width_in}×{c.height_in} in,
                  max {c.max_weight_lb} lb)
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
        </Form>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/*  Orders component: unified Scan → Preview → Pack workflow          */
/* ------------------------------------------------------------------ */
export default function Orders() {
  const [mode, setMode] = useState("scan"); // "scan" | "preview" | "pack"
  const [orderNo, setOrderNo] = useState("");
  const [loading, setLoading] = useState(false);
  const [oesData, setOesData] = useState(null);
  const [pack, setPack] = useState(null);
  const [showAddBoxModal, setShowAddBoxModal] = useState(false);

  async function handleScan(value) {
    if (!value) return;
    setLoading(true);
    try {
      const data = await getOesOrder(value.trim());
      setOesData(data);
      setOrderNo(value.trim());
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

  /* ---------------------- Scan Mode ---------------------- */
  if (mode === "scan") {
    return (
      <div style={{ maxWidth: 400, margin: "80px auto", textAlign: "center" }}>
        <h2>Scan or Enter Order #</h2>
        <Input.Search
          placeholder="Order number"
          enterButton="Search"
          size="large"
          onSearch={(val) => handleScan(val)}
          autoFocus
        />
      </div>
    );
  }

  /* ---------------------- Preview Mode ---------------------- */
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

  /* ---------------------- Pack Mode ---------------------- */
  if (mode === "pack") {
    const packId = pack.header.pack_id;

    async function handleCompletePack() {
      try {
        await completePack(packId);
        message.success("Pack marked as complete");
        const snap = await getPackSnapshot(packId);
        setPack(snap);
      } catch (err) {
        message.error(
          err.response?.data?.detail || "Failed to complete pack"
        );
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
                <Button
                  type="primary"
                  size="small"
                  onClick={() => setShowAddBoxModal(true)}
                >
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

        <AddBoxModal
          visible={showAddBoxModal}
          onClose={() => setShowAddBoxModal(false)}
          packId={pack.header.pack_id}
          onBoxAdded={async () => {
            const snap = await getPackSnapshot(pack.header.pack_id);
            setPack(snap);
          }}
        />
      </div>
    );
  }

  return null;
}
